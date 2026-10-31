import type { Kysely } from "kysely";
import { z } from "zod";
import { addMonths } from "../engine/months.ts";
import type { FetchedPrice, FetchProblemReason, PriceProvider } from "../engine/priceFetch.ts";
import { classifyFetchedPrice, monthEndCloses } from "../engine/priceFetch.ts";
import { toScaled } from "../engine/units.ts";
import type { DB } from "./db.ts";
import { storePrice } from "./prices.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { findOr404 } from "./rows.ts";

/** The `meta` row that holds the review list and the provider errors, as one JSON document. */
const STATE_KEY = "priceFetch";

const reviewItemSchema = z.object({
  /** `<productId>|<month>`: a later fetch of the same product and month replaces the item. */
  id: z.string(),
  productId: z.string(),
  ticker: z.string(),
  month: z.string(),
  date: z.string(),
  /** The close in `currency`, as the provider gave it. */
  price: z.number(),
  currency: z.string(),
  reason: z.enum(["non-eur", "move-above-25"]),
});
const stateSchema = z.object({
  review: z.array(reviewItemSchema).default([]),
  errors: z.array(z.object({ productId: z.string(), message: z.string() })).default([]),
});
type State = z.infer<typeof stateSchema>;
export type ReviewItem = z.infer<typeof reviewItemSchema>;

export interface FetchProblem {
  productId: string;
  reason: FetchProblemReason;
}

export interface FetchResult {
  /** Prices written by this run. */
  stored: { productId: string; month: string; price: number }[];
  /** Prices put on the review list by this run. */
  reviewed: ReviewItem[];
  /** The problems of the products fetched by this run. */
  problems: FetchProblem[];
  /** The provider error text per failed product. */
  errors: State["errors"];
}

async function loadState(db: Kysely<DB>): Promise<State> {
  const row = await db
    .selectFrom("meta")
    .select("value")
    .where("key", "=", STATE_KEY)
    .executeTakeFirst();
  return stateSchema.parse(row ? JSON.parse(row.value) : {});
}

async function saveState(db: Kysely<DB>, state: State): Promise<void> {
  const value = JSON.stringify(state);
  await db
    .insertInto("meta")
    .values({ key: STATE_KEY, value })
    .onConflict((conflict) => conflict.column("key").doUpdateSet({ value }))
    .execute();
}

type Fetched = { rows: FetchedPrice[] } | { error: string };

/** One provider call per product, so the failure of one product does not hide the others. */
async function fetchOne(
  provider: PriceProvider,
  ticker: string,
  from: string,
  to: string,
): Promise<Fetched> {
  if (ticker.trim() === "") return { error: "The product has no ticker." };
  try {
    const wanted = ticker.trim().toUpperCase();
    const rows = (await provider.fetch([ticker], from, to)).filter(
      (row) => row.ticker.toUpperCase() === wanted,
    );
    return rows.length > 0 ? { rows } : { error: `The provider returned no price for ${ticker}.` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Fetches the latest prices of the products and stores the safe ones. The window is last month and
 * this month, so the month-end close of last month is filled in too. Per month-end close: a price in
 * a currency other than EUR, or one that moved more than 25% from the previous month's stored price,
 * goes to the review list and is not stored; any other price is stored through the #31 write rule.
 * A provider error does not throw: it is recorded as a fetch problem of the product.
 *
 * @param db Database handle.
 * @param provider Where the prices come from.
 * @param products The products to fetch, each with its ticker.
 * @param options `explicitRefetch`: a provider price may replace a manual one of the same month.
 *   `today`: the app clock, `YYYY-MM-DD`.
 */
export async function fetchPrices(
  db: Kysely<DB>,
  provider: PriceProvider,
  products: readonly { id: string; ticker: string }[],
  { explicitRefetch, today }: { explicitRefetch: boolean; today: string },
): Promise<FetchResult> {
  const from = `${addMonths(today.slice(0, 7), -1)}-01`;
  // The provider is called before the transaction opens, so a slow request holds no database lock.
  // One product at a time, to stay polite to a free endpoint.
  const answers: { product: (typeof products)[number]; fetched: Fetched }[] = [];
  for (const product of products) {
    answers.push({ product, fetched: await fetchOne(provider, product.ticker, from, today) });
  }
  const fetchedAt = new Date().toISOString();

  return db.transaction().execute(async (trx) => {
    const state = await loadState(trx);
    const result: FetchResult = { stored: [], reviewed: [], problems: [], errors: [] };
    for (const { product, fetched } of answers) {
      state.errors = state.errors.filter((error) => error.productId !== product.id);
      if ("error" in fetched) {
        state.errors.push({ productId: product.id, message: fetched.error });
        result.errors.push({ productId: product.id, message: fetched.error });
        result.problems.push({ productId: product.id, reason: "provider-error" });
        continue;
      }
      // Oldest month first, so a month is checked against the month stored just before it.
      for (const close of monthEndCloses(fetched.rows)) {
        const month = close.date.slice(0, 7);
        const id = `${product.id}|${month}`;
        const previous = await trx
          .selectFrom("pricePoint")
          .select("priceScaled")
          .where("productId", "=", product.id)
          .where("month", "=", addMonths(month, -1))
          .executeTakeFirst();
        const priceScaled = toScaled(close.close);
        const reason = classifyFetchedPrice({
          currency: close.currency,
          priceScaled,
          previousScaled: previous?.priceScaled ?? null,
        });
        state.review = state.review.filter((item) => item.id !== id);
        if (reason) {
          const item: ReviewItem = {
            id,
            productId: product.id,
            ticker: product.ticker,
            month,
            date: close.date,
            price: close.close,
            currency: close.currency,
            reason,
          };
          state.review.push(item);
          result.reviewed.push(item);
          result.problems.push({ productId: product.id, reason });
          continue;
        }
        const stored = await storePrice(
          trx,
          {
            productId: product.id,
            month,
            priceScaled,
            priceDate: close.date,
            source: "provider",
            fetchedAt,
            importBatchId: null,
          },
          { explicitRefetch },
        );
        if (stored.outcome === "stored") {
          result.stored.push({ productId: product.id, month, price: close.close });
        }
      }
    }
    await saveState(trx, state);
    return result;
  });
}

/** Ids of the products that still exist and still take their price from the provider. */
async function providerProducts(db: Kysely<DB>): Promise<Map<string, string>> {
  const rows = await db
    .selectFrom("product")
    .select(["id", "name"])
    .where("priceSource", "=", "provider")
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The review list: fetched prices held back, with the product name. It survives a restart. */
export async function readReviewList(
  db: Kysely<DB>,
): Promise<(ReviewItem & { productName: string })[]> {
  const names = await providerProducts(db);
  const { review } = await loadState(db);
  return review.flatMap((item) => {
    const productName = names.get(item.productId);
    return productName === undefined ? [] : [{ ...item, productName }];
  });
}

/** The provider error text per product, with the product name. */
export async function readFetchErrors(
  db: Kysely<DB>,
): Promise<(State["errors"][number] & { productName: string })[]> {
  const names = await providerProducts(db);
  return (await loadState(db)).errors.flatMap((error) => {
    const productName = names.get(error.productId);
    return productName === undefined ? [] : [{ ...error, productName }];
  });
}

/**
 * The products with a fetch problem: a provider error, a price in another currency or a move above
 * 25% that is still on the review list. This is the set rule R10 ("Price fetch failed") reads.
 */
export async function priceFetchProblems(db: Kysely<DB>): Promise<FetchProblem[]> {
  const names = await providerProducts(db);
  const { review, errors } = await loadState(db);
  return [
    ...errors.map(({ productId }): FetchProblem => ({ productId, reason: "provider-error" })),
    ...review.map(({ productId, reason }): FetchProblem => ({ productId, reason })),
  ].filter((problem) => names.has(problem.productId));
}

async function takeItem(db: Kysely<DB>, id: string) {
  const state = await loadState(db);
  const item = state.review.find((candidate) => candidate.id === id);
  if (!item) throw new HttpError(404, "review item not found");
  return { item, state: { ...state, review: state.review.filter((i) => i.id !== id) } };
}

/**
 * Stores a review item as a `provider` price and removes it from the list. The user chose to
 * accept it, so it replaces a manual price of the same month, like an explicit re-fetch. A price
 * in another currency cannot be accepted: it would be stored as euros.
 *
 * @throws HttpError 404 when the item does not exist, or its product is gone or no longer uses
 *   the provider. HttpError 400 for a `non-eur` item.
 */
export async function acceptReviewItem(db: Kysely<DB>, id: string): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const { item, state } = await takeItem(trx, id);
    if (item.reason === "non-eur") {
      throw new HttpError(400, `The price is in ${item.currency}, not EUR: discard it.`);
    }
    const product = await findOr404(trx, "product", item.productId, "product");
    if (product.priceSource !== "provider") {
      throw new HttpError(404, "review item not found");
    }
    await storePrice(
      trx,
      {
        productId: item.productId,
        month: item.month,
        priceScaled: toScaled(item.price),
        priceDate: item.date,
        source: "provider",
        fetchedAt: new Date().toISOString(),
        importBatchId: null,
      },
      { explicitRefetch: true },
    );
    await saveState(trx, state);
  });
}

/**
 * Removes a review item without storing it.
 *
 * @throws HttpError 404 when the item does not exist.
 */
export async function discardReviewItem(db: Kysely<DB>, id: string): Promise<void> {
  await saveState(db, (await takeItem(db, id)).state);
}

const fetchBody = z.object({ productId: z.string().min(1).optional() });
const itemBody = z.object({ id: z.string().min(1) });

/** Fetch latest prices, one product's explicit re-fetch, and the review list. */
export function registerPriceFetchRoutes(
  router: Router,
  db: Kysely<DB>,
  today: () => string,
  provider: PriceProvider,
): void {
  router.route("POST", "/api/prices/fetch", fetchBody, async ({ productId }) => {
    let products: { id: string; ticker: string }[];
    if (productId) {
      const product = await findOr404(db, "product", productId, "product");
      if (product.priceSource !== "provider") {
        throw new HttpError(400, "This product does not take its price from the provider.");
      }
      products = [product];
    } else {
      products = await db
        .selectFrom("product")
        .select(["id", "ticker"])
        .where("priceSource", "=", "provider")
        .execute();
    }
    return fetchPrices(db, provider, products, {
      explicitRefetch: productId !== undefined,
      today: today(),
    });
  });

  router.route("GET", "/api/prices/review", z.object({}), async () => ({
    items: await readReviewList(db),
    problems: await priceFetchProblems(db),
    errors: await readFetchErrors(db),
  }));

  router.route("POST", "/api/prices/review/accept", itemBody, async ({ id }) => {
    await acceptReviewItem(db, id);
    return { id };
  });

  router.route("POST", "/api/prices/review/discard", itemBody, async ({ id }) => {
    await discardReviewItem(db, id);
    return { id };
  });
}
