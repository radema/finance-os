import type { Kysely } from "kysely";
import { z } from "zod";
import type { PriceProvider } from "../engine/priceFetch.ts";
import type { DB } from "./db.ts";
import { fetchPrices } from "./priceFetch.ts";
import type { Router } from "./router.ts";
import { ensureSnapshots } from "./snapshots.ts";

/** The `meta` row that holds the last run of the job, as one JSON document. No migration needed. */
const STATE_KEY = "monthlyJob";

const stateSchema = z.object({
  /** The app date of the last run, success or not. */
  lastRunDate: z.string().nullable().default(null),
  lastRunFailed: z.boolean().default(false),
  /** The month (`YYYY-MM`) of the last run that worked: the start-up job runs when it is not this month. */
  lastSuccessMonth: z.string().nullable().default(null),
});
type State = z.infer<typeof stateSchema>;

/** What `GET /api/jobs/monthly` shows. */
export type MonthlyJobStatus = Pick<State, "lastRunDate" | "lastRunFailed"> & { running: boolean };

export interface MonthlyJobDeps {
  db: Kysely<DB>;
  provider: PriceProvider;
  /** The app clock, `YYYY-MM-DD`. */
  clock: () => string;
}

export interface MonthlyJobResult {
  /** Month-end prices stored by the fetch. */
  fetched: number;
  /** Snapshots stored by the run, `saved` and `recomputed`. */
  snapshotsSaved: number;
  failed: boolean;
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

/**
 * Fetches month-end prices, then saves the previous month's snapshot and catches up older months.
 * Prices come first: a saved snapshot never changes, so it must not be taken before its month-end
 * price is in. When the fetch fails (a provider error for any product), the snapshots are skipped
 * and the run is recorded as failed, so the next start or a manual run tries again. Nothing throws:
 * a failure never stops the app.
 *
 * @returns Counts and `failed`. The run is recorded in the `meta` table.
 */
export async function runMonthlyJob({
  db,
  provider,
  clock,
}: MonthlyJobDeps): Promise<MonthlyJobResult> {
  const today = clock();
  const result: MonthlyJobResult = { fetched: 0, snapshotsSaved: 0, failed: false };
  try {
    const products = await db
      .selectFrom("product")
      .select(["id", "ticker"])
      .where("priceSource", "=", "provider")
      .execute();
    const fetch = await fetchPrices(db, provider, products, { explicitRefetch: false, today });
    result.fetched = fetch.stored.length;
    if (fetch.errors.length > 0) {
      result.failed = true;
    } else {
      const { saved, recomputed } = await ensureSnapshots(db, today);
      result.snapshotsSaved = saved.length + recomputed.length;
    }
  } catch (error) {
    console.error("Monthly job failed:", error);
    result.failed = true;
  }
  const previous = await loadState(db);
  await saveState(db, {
    lastRunDate: today,
    lastRunFailed: result.failed,
    lastSuccessMonth: result.failed ? previous.lastSuccessMonth : today.slice(0, 7),
  });
  return result;
}

/**
 * Registers the job's routes. A run that is going on blocks a second one.
 *
 * @returns `startup`: runs the job when this month has no successful run yet and the app has goals
 *   (an empty app has nothing to snapshot). It never rejects. The caller does not wait for it, so
 *   a slow provider does not hold the app back; `close` waits for it.
 */
export function registerMonthlyJobRoutes(router: Router, deps: MonthlyJobDeps) {
  const { db, clock } = deps;
  let running = false;
  // The guard is set before the first await, so a manual run during start-up sees it.
  const exclusive = async <T>(body: () => Promise<T>): Promise<T | "busy"> => {
    if (running) return "busy";
    running = true;
    try {
      return await body();
    } finally {
      running = false;
    }
  };

  router.route("GET", "/api/jobs/monthly", z.object({}), async (): Promise<MonthlyJobStatus> => {
    const { lastRunDate, lastRunFailed } = await loadState(db);
    return { lastRunDate, lastRunFailed, running };
  });

  router.route("POST", "/api/jobs/monthly/run", z.object({}).optional(), async () => {
    const answer = await exclusive(async () => {
      const state = await loadState(db);
      if (state.lastRunDate === clock() && !state.lastRunFailed) {
        return { ran: false, reason: "already ran today" };
      }
      return { ran: true, ...(await runMonthlyJob(deps)) };
    });
    return answer === "busy" ? { ran: false, reason: "already running" } : answer;
  });

  return {
    async startup(): Promise<void> {
      await exclusive(async () => {
        const state = await loadState(db);
        if (state.lastSuccessMonth === clock().slice(0, 7)) return;
        if (!(await db.selectFrom("goal").select("id").limit(1).executeTakeFirst())) return;
        await runMonthlyJob(deps);
      });
    },
  };
}
