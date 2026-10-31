import type { BucketWeight } from "./bucket.ts";
import { assignBucket } from "./bucket.ts";
import type { LedgerRow, Regime } from "./holdings.ts";
import { holdingsAt, unitPrice } from "./holdings.ts";
import type { ConfirmedSplit, CouponPart, UnitPart } from "./split.ts";
import { confirmSplit, splitCoupon } from "./split.ts";
import { fromScaled, toCents, toScaled } from "./units.ts";

/** One normalised row of a broker file. Numbers are exact decimal text, `null` when empty. */
export type ImportRow = {
  /** Row number in the file; the key of the user's decisions. */
  rowNumber: number;
  /** `YYYY-MM-DD`, or `null` when the date cannot be read. */
  date: string | null;
  /** The date cell as read, for the "needs fix" message. */
  dateText: string;
  isin: string;
  ticker?: string;
  name?: string;
  /** Display hint for a product that is not found; never used to match. */
  title: string;
  /** `unknown` covers an unrecognised `Descrizione` and a trade without a valid `Segno`. */
  type: "buy" | "sell" | "coupon" | "unknown";
  /** Unsigned or signed as in the file; the sign comes from `type`. */
  qty: string | null;
  /** As in the file; a BTP is priced per 100. */
  price: string | null;
  commission: string | null;
  controvalore: string | null;
  currency: string;
  fx: string | null;
  description: string;
  /** The goal id the bucket column resolved to: `undefined` when absent, `null` when unknown. */
  bucket?: string | null;
};

export type ImportProduct = {
  id: string;
  isin: string;
  ticker: string;
  name: string;
  regime: Regime;
};

/** A stored buy or sell, reduced to what the "already in your records" check compares. */
export type StoredTrade = {
  date: string;
  productId: string;
  priceScaled: number;
  /** Signed: a sell is negative. */
  qtyScaled: number;
};

/** A stored coupon, reduced to what the "already in your records" check compares. */
export type StoredCoupon = {
  date: string;
  productId: string;
  amountCents: number;
};

/** The current data the preview reads. Plain values: the preview does no I/O. */
export type ImportState = {
  products: readonly ImportProduct[];
  goalIds: readonly string[];
  weights: readonly BucketWeight[];
  ledger: readonly LedgerRow[];
  storedTrades: readonly StoredTrade[];
  storedCoupons: readonly StoredCoupon[];
  /** The opening position's asOf date; `null` when none is saved. */
  openingAsOf: string | null;
};

/** What the user decided for one row. */
export type RowDecision = {
  /** One bucket for the whole row. */
  goalId?: string;
  /** Units per bucket; used only when `confirmed` is true. */
  split?: { units: UnitPart[]; confirmed: boolean };
  /** "This is a real order": lets a row that repeats another row of the file through. */
  confirmDuplicate?: boolean;
};

export type RowStatus =
  | "ready"
  | "already in your records"
  | "already in the opening position"
  | "needs a goal"
  | "product not found"
  | "needs fix";

export type PreviewRow = {
  rowNumber: number;
  status: RowStatus;
  /** Why the row is not ready. */
  reasons: string[];
  /** Notes on a row that stays as it is. */
  warnings: string[];
  productId: string | null;
  /** The confirmed split to write. Non-null only when the status is `ready`. */
  split: ConfirmedSplit | null;
  /** The coupon parts to write. Non-empty only when the status is `ready` and the row is a coupon. */
  couponParts: CouponPart[];
  /** The buckets the user can pick from, when the status is `needs a goal`. */
  candidates: string[];
};

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A decimal text as a number; `null` when it is empty or not a plain decimal. */
export const parseDecimal = (text: string | null): number | null =>
  text !== null && DECIMAL.test(text.trim()) ? Number(text) : null;

const END_OF_TIME = "9999-12-31";

const result = (
  row: ImportRow,
  status: RowStatus,
  reasons: string[],
  extra: Partial<PreviewRow> = {},
): PreviewRow => ({
  rowNumber: row.rowNumber,
  status,
  reasons,
  warnings: [],
  productId: null,
  split: null,
  couponParts: [],
  candidates: [],
  ...extra,
});

/** Field problems of a row, without looking at the data. Empty when the row reads fine. */
function fieldProblems(row: ImportRow): string[] {
  const problems: string[] = [];
  if (row.date === null) problems.push(`unreadable date "${row.dateText}"`);
  if (row.currency.trim().toUpperCase() !== "EUR") {
    problems.push(`currency is "${row.currency}", not EUR`);
  }
  if (row.fx !== null && parseDecimal(row.fx) !== 1) problems.push(`Cambio is "${row.fx}", not 1`);
  if (row.type === "unknown") {
    problems.push(`type not recognised: check Descrizione "${row.description}" and Segno (A or V)`);
  }
  if (row.type === "coupon") {
    const value = parseDecimal(row.controvalore);
    if (value === null || value <= 0) problems.push("Controvalore is missing or not above 0");
  } else {
    const qty = parseDecimal(row.qty);
    if (qty === null || qty === 0) problems.push("qty is missing or 0");
    const price = parseDecimal(row.price);
    if (price === null || price <= 0) problems.push("price is missing or not above 0");
  }
  if (row.commission !== null) {
    const commission = parseDecimal(row.commission);
    if (commission === null) problems.push("commission is not a number");
    else if (commission < 0) problems.push("commission is negative");
  }
  return problems;
}

/** A row that read fine, with its numbers parsed. */
type Parsed = {
  row: ImportRow;
  date: string;
  product: ImportProduct;
  productId: string;
  /** Positive units of the broker row. */
  units: number;
  /** Signed: a sell is negative. */
  qtyScaled: number;
  priceScaled: number;
  commissionCents: number;
};

function findProduct(row: ImportRow, products: readonly ImportProduct[]): ImportProduct | null {
  const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
  const isin = row.isin.trim() === "" ? undefined : row.isin;
  const ticker = (row.ticker ?? "").trim() === "" ? undefined : row.ticker;
  return (
    (isin && products.find((p) => p.isin !== "" && same(p.isin, isin))) ||
    (ticker && products.find((p) => p.ticker !== "" && same(p.ticker, ticker))) ||
    (row.name && products.find((p) => p.name === row.name)) ||
    null
  );
}

/** Warns when `Controvalore` is not qty x price, nor that plus or minus the commission, in cents. */
function controvaloreWarning(parsed: Parsed): string[] {
  const { row, product, units, priceScaled, commissionCents } = parsed;
  if (row.controvalore === null) return [];
  const value = parseDecimal(row.controvalore);
  if (value === null) return ["Controvalore is not a number"];
  const gross = toCents(units * unitPrice(product.regime, priceScaled / 1_000_000));
  const accepted = [gross, gross + commissionCents, gross - commissionCents];
  return accepted.includes(toCents(Math.abs(value)))
    ? []
    : [`Controvalore ${row.controvalore} does not match qty x price (${gross / 100})`];
}

/** The confirmed split of one row, or why the user still has to act. */
function resolveSplit(
  parsed: Parsed,
  decision: RowDecision | undefined,
  state: ImportState,
  holdings: ReturnType<typeof holdingsAt>,
): { split: ConfirmedSplit } | { reason: string; candidates: string[] } {
  const { row, units, commissionCents } = parsed;
  let parts: UnitPart[];
  if (decision?.split) {
    if (!decision.split.confirmed) return { reason: "the split is not confirmed", candidates: [] };
    parts = decision.split.units;
  } else {
    const assignment = assignBucket(
      { productId: parsed.product.id, bucket: decision?.goalId ?? row.bucket },
      holdings,
      state.weights,
    );
    if ("needsGoal" in assignment) {
      return { reason: "pick a bucket or split the row", candidates: assignment.candidates };
    }
    parts = [{ goalId: assignment.goalId, units }];
  }
  const unknown = parts.find((part) => !state.goalIds.includes(part.goalId));
  if (unknown) return { reason: `bucket "${unknown.goalId}" is not a goal`, candidates: [] };
  try {
    return { split: confirmSplit({ totalUnits: units, commissionCents, units: parts }) };
  } catch (error) {
    if (error instanceof RangeError) return { reason: error.message, candidates: [] };
    throw error;
  }
}

/** The ledger rows a ready trade adds, so a coupon of the same file counts its units. */
function ledgerRows(p: Parsed, split: ConfirmedSplit): LedgerRow[] {
  const price = unitPrice(p.product.regime, fromScaled(p.priceScaled));
  return split.parts.map((part) => ({
    date: p.date,
    goalId: part.goalId,
    productId: p.productId,
    type: p.row.type === "sell" ? "sell" : "buy",
    qty: p.row.type === "sell" ? -part.units : part.units,
    price,
  }));
}

/** A coupon row that read fine. */
type ParsedCoupon = {
  row: ImportRow;
  date: string;
  productId: string;
  /** The net cash received, in cents. */
  amountCents: number;
};

/**
 * The parts of one coupon: split by the units each bucket holds on the coupon date, with no user
 * choice. When no bucket holds the bond, the user picks one bucket.
 */
function resolveCoupon(
  coupon: ParsedCoupon,
  decision: RowDecision | undefined,
  state: ImportState,
  ledger: readonly LedgerRow[],
): { parts: CouponPart[] } | { reason: string; candidates: string[] } {
  const { units } = holdingsAt(ledger, coupon.date);
  const held: UnitPart[] = [];
  for (const [goalId, products] of units) {
    const count = products.get(coupon.productId) ?? 0;
    if (toScaled(count) > 0) held.push({ goalId, units: count });
  }
  if (held.length > 0) return { parts: splitCoupon(coupon.amountCents, held) };

  const candidates = [
    ...new Set(
      state.weights
        .filter((w) => w.productId === coupon.productId && w.weight > 0)
        .map((w) => w.goalId),
    ),
  ].sort();
  const goalId = decision?.goalId;
  if (goalId === undefined) {
    return { reason: "no bucket holds the bond on this date: pick a bucket", candidates };
  }
  if (!state.goalIds.includes(goalId)) {
    return { reason: `bucket "${goalId}" is not a goal`, candidates };
  }
  return { parts: [{ goalId, amountCents: coupon.amountCents }] };
}

/** The preview of each coupon row: already stored, ready with its parts, or needs a goal. */
function couponStatuses(
  coupons: readonly ParsedCoupon[],
  state: ImportState,
  decisions: Readonly<Record<number, RowDecision>>,
  ledger: readonly LedgerRow[],
): Map<ImportRow, PreviewRow> {
  const keyOf = (c: { date: string; productId: string }) => `${c.date}|${c.productId}`;
  const sumBy = (items: readonly { date: string; productId: string; amountCents: number }[]) => {
    const totals = new Map<string, number>();
    for (const item of items)
      totals.set(keyOf(item), (totals.get(keyOf(item)) ?? 0) + item.amountCents);
    return totals;
  };
  const stored = sumBy(state.storedCoupons);
  const inFile = sumBy(coupons);

  const results = new Map<ImportRow, PreviewRow>();
  for (const coupon of coupons) {
    const { row, productId } = coupon;
    const found = stored.get(keyOf(coupon));
    if (found !== undefined && found === inFile.get(keyOf(coupon))) {
      results.set(
        row,
        result(row, "already in your records", ["the stored coupons already cover it"], {
          productId,
        }),
      );
      continue;
    }
    const same = coupons.filter((other) => keyOf(other) === keyOf(coupon));
    if (same.length > 1 && decisions[row.rowNumber]?.confirmDuplicate !== true) {
      const others = same
        .filter((other) => other.row !== row)
        .map((other) => other.row.rowNumber)
        .join(", ");
      results.set(
        row,
        result(
          row,
          "needs fix",
          [`same date and product as the coupon of row ${others}: confirm it as a real coupon`],
          { productId },
        ),
      );
      continue;
    }
    const resolved = resolveCoupon(coupon, decisions[row.rowNumber], state, ledger);
    results.set(
      row,
      "parts" in resolved
        ? result(row, "ready", [], { productId, couponParts: resolved.parts })
        : result(row, "needs a goal", [resolved.reason], {
            productId,
            candidates: resolved.candidates,
          }),
    );
  }
  return results;
}

/**
 * Checks every row against the current data and the user's decisions. Pure: no I/O. The commit
 * calls it again and ignores any status the client holds.
 *
 * A row can match several statuses; the first of these applies:
 * 1. `needs fix` for a field problem (date, currency, Cambio, type, qty, price, commission);
 * 2. `already in the opening position` (date <= the opening asOf, when there is one);
 * 3. `product not found`;
 * 4. `already in your records`: per key (date, product, price), the file's total signed qty equals
 *    the stored total, and something is stored. When the stored total is not zero and differs,
 *    the rows stay in the normal flow. A coupon uses the key (date, product) and compares the net
 *    amount in cents;
 * 5. `needs fix` for a row identical to another one of the file (date, product, qty, price; for a
 *    coupon, date and product) unless the user confirmed it as a real order;
 * 6. `needs a goal`, then `ready`.
 *
 * A coupon row is split by the units held on its date: the stored ledger plus the ready trade rows
 * of the file. `needs a goal` for a coupon means no bucket holds the bond.
 *
 * @param rows Normalised rows of one file, in file order.
 * @param state The current data.
 * @param decisions The user's decisions, by row number.
 * @returns One result per row, in input order.
 */
export function previewTransactionImport(
  rows: readonly ImportRow[],
  state: ImportState,
  decisions: Readonly<Record<number, RowDecision>>,
): PreviewRow[] {
  const results = new Map<ImportRow, PreviewRow>();
  const live: Parsed[] = [];
  const coupons: ParsedCoupon[] = [];

  for (const row of rows) {
    const problems = fieldProblems(row);
    if (problems.length > 0) {
      results.set(row, result(row, "needs fix", problems));
      continue;
    }
    const date = row.date as string;
    if (state.openingAsOf !== null && date <= state.openingAsOf) {
      results.set(
        row,
        result(row, "already in the opening position", [
          `${date} is on or before the opening position date ${state.openingAsOf}`,
        ]),
      );
      continue;
    }
    const product = findProduct(row, state.products);
    if (product === null) {
      const hint = row.title === "" ? "" : ` (${row.title})`;
      results.set(
        row,
        result(row, "product not found", [`no product with ISIN ${row.isin}${hint}`]),
      );
      continue;
    }
    if (row.type === "coupon") {
      const amountCents = toCents(parseDecimal(row.controvalore) as number);
      coupons.push({ row, date, productId: product.id, amountCents });
      continue;
    }
    const units = Math.abs(parseDecimal(row.qty) as number);
    live.push({
      row,
      date,
      product,
      productId: product.id,
      units,
      qtyScaled: toScaled(row.type === "sell" ? -units : units),
      priceScaled: toScaled(parseDecimal(row.price) as number),
      commissionCents: toCents(parseDecimal(row.commission) ?? 0),
    });
  }

  // Already in your records: totals per key (date, product, price).
  const keyOf = (p: { date: string; productId: string; priceScaled: number }) =>
    `${p.date}|${p.productId}|${p.priceScaled}`;
  const stored = new Map<string, number>();
  for (const trade of state.storedTrades) {
    stored.set(keyOf(trade), (stored.get(keyOf(trade)) ?? 0) + trade.qtyScaled);
  }
  const fileTotals = new Map<string, number>();
  for (const p of live) {
    const key = keyOf(p);
    fileTotals.set(key, (fileTotals.get(key) ?? 0) + p.qtyScaled);
  }
  const open: Parsed[] = [];
  for (const p of live) {
    const key = keyOf(p);
    const found = stored.get(key);
    if (found !== undefined && found === fileTotals.get(key)) {
      results.set(
        p.row,
        result(p.row, "already in your records", ["the stored transactions already cover it"], {
          productId: p.product.id,
        }),
      );
    } else open.push(p);
  }

  // Identical rows of one file: the user decides whether they are separate orders.
  const identical = new Map<string, number[]>();
  for (const p of open) {
    const key = `${keyOf(p)}|${p.qtyScaled}`;
    identical.set(key, [...(identical.get(key) ?? []), p.row.rowNumber]);
  }

  const holdings = holdingsAt(state.ledger, END_OF_TIME);
  const readyTrades: LedgerRow[] = [];
  for (const p of open) {
    const { row } = p;
    const base = { productId: p.product.id, warnings: controvaloreWarning(p) };
    const same = identical.get(`${keyOf(p)}|${p.qtyScaled}`) ?? [];
    if (same.length > 1 && decisions[row.rowNumber]?.confirmDuplicate !== true) {
      const others = same.filter((n) => n !== row.rowNumber).join(", ");
      results.set(
        row,
        result(
          row,
          "needs fix",
          [`same date, product, qty and price as row ${others}: confirm it as a real order`],
          base,
        ),
      );
      continue;
    }
    const resolved = resolveSplit(p, decisions[row.rowNumber], state, holdings);
    if ("split" in resolved) readyTrades.push(...ledgerRows(p, resolved.split));
    results.set(
      row,
      "split" in resolved
        ? result(row, "ready", [], { ...base, split: resolved.split })
        : result(row, "needs a goal", [resolved.reason], {
            ...base,
            candidates: resolved.candidates,
          }),
    );
  }

  const couponResults = couponStatuses(coupons, state, decisions, [
    ...state.ledger,
    ...readyTrades,
  ]);
  return rows.map((row) => (results.get(row) ?? couponResults.get(row)) as PreviewRow);
}
