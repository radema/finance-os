import { createHash } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { addMonths, monthEnd } from "../engine/months.ts";
import {
  cashFlowSchema,
  commissionSchema,
  correlationsSchema,
  fireSettingsSchema,
  monthSchema,
  settingsSchema,
} from "../engine/schemas.ts";
import type { SnapshotGoal, SnapshotSource, SnapshotView } from "../engine/snapshot.ts";
import { computeSnapshot } from "../engine/snapshot.ts";
import type { DB } from "./db.ts";
import { loadDocument } from "./documents.ts";
import { loadWorld } from "./goalViews.ts";
import { loadPensionPlan, voluntaryYtdCents } from "./pensionPlan.ts";
import type { Router } from "./router.ts";
import { HttpError } from "./router.ts";
import { idQuery } from "./rows.ts";
import { loadLedger } from "./transactions.ts";

type Source = SnapshotSource;

export type { SnapshotView };

/**
 * A stable hash of every assumption document the analysis reads: settings, commission, FI settings,
 * correlations, pension plan and cash flow. Documents come back through their zod schemas, so their
 * key order is fixed.
 */
export async function assumptionsHash(db: Kysely<DB>): Promise<string> {
  const documents = [
    await loadDocument(db, "settings", settingsSchema),
    await loadDocument(db, "commission", commissionSchema),
    await loadDocument(db, "fiSettings", fireSettingsSchema),
    await loadDocument(db, "correlations", correlationsSchema),
    (await loadPensionPlan(db)) ?? null,
    await loadDocument(db, "cashFlow", cashFlowSchema),
  ];
  return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
}

/** The analysis of every goal at each month, from the data and the assumptions as they are now. */
async function computeMonths(
  db: Kysely<DB>,
  today: string,
  months: string[],
): Promise<SnapshotGoal[][]> {
  const world = await loadWorld(db, today);
  const ledger = await loadLedger(db);
  return months.map((month) =>
    computeSnapshot({
      ...world,
      month,
      voluntaryYtdCents: voluntaryYtdCents(ledger, monthEnd(month)),
    }),
  );
}

/** Stores a snapshot. A saved one takes the place of a recomputed one of the same month. */
async function store(
  db: Kysely<DB>,
  month: string,
  source: Source,
  hash: string,
  goals: SnapshotGoal[],
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    if (source === "saved") {
      await trx
        .deleteFrom("snapshot")
        .where("month", "=", month)
        .where("source", "=", "recomputed")
        .execute();
    }
    await trx
      .insertInto("snapshot")
      .values({ month, source, assumptionsHash: hash, results: JSON.stringify(goals) })
      .execute();
  });
}

/**
 * Saves the previous month of `asOf` as `saved` when it has no saved snapshot, and catches up every
 * older month from the tracking start that has no snapshot as `recomputed`, with the current
 * assumptions. Saved snapshots are never touched.
 *
 * @param db Database handle.
 * @param asOf The app clock, `YYYY-MM-DD`.
 * @returns The months stored as `saved` and as `recomputed`.
 */
export async function ensureSnapshots(
  db: Kysely<DB>,
  asOf: string,
): Promise<{ saved: string[]; recomputed: string[] }> {
  const { trackingStart } = await loadDocument(db, "settings", settingsSchema);
  const previous = addMonths(asOf.slice(0, 7), -1);
  const existing = await db.selectFrom("snapshot").select(["month", "source"]).execute();
  const has = (month: string, source?: Source) =>
    existing.some((row) => row.month === month && (source === undefined || row.source === source));

  const saved: string[] = [];
  const recomputed: string[] = [];
  for (let month = trackingStart; month <= previous; month = addMonths(month, 1)) {
    if (month === previous && !has(month, "saved")) saved.push(month);
    else if (month !== previous && !has(month)) recomputed.push(month);
  }
  const hash = await assumptionsHash(db);
  const months = [...saved, ...recomputed];
  const computed = await computeMonths(db, asOf, months);
  for (const [index, goals] of computed.entries()) {
    const month = months[index] as string;
    await store(db, month, saved.includes(month) ? "saved" : "recomputed", hash, goals);
  }
  return { saved, recomputed };
}

const toView = (row: DB["snapshot"]): SnapshotView => ({
  id: row.month,
  month: row.month,
  source: row.source,
  assumptionsHash: row.assumptionsHash,
  goals: JSON.parse(row.results) as SnapshotGoal[],
});

/** Every stored snapshot, oldest month first. */
export async function loadSnapshots(db: Kysely<DB>): Promise<SnapshotView[]> {
  return (await db.selectFrom("snapshot").selectAll().orderBy("month").execute()).map(toView);
}

const saveBody = z.object({ month: monthSchema.optional() }).optional();

/** Snapshots: list, save one by hand, delete a saved one. */
export function registerSnapshotRoutes(router: Router, db: Kysely<DB>, today: () => string): void {
  const read = async (month: string) => {
    const row = await db
      .selectFrom("snapshot")
      .selectAll()
      .where("month", "=", month)
      .executeTakeFirst();
    return row ? toView(row) : undefined;
  };

  router.route("GET", "/api/snapshots", z.object({}), () => loadSnapshots(db));

  // The month defaults to the valuation month: the last month that has prices, else the clock's.
  router.route("POST", "/api/snapshots", saveBody, async (input) => {
    const valuation = (await loadWorld(db, today())).month;
    const month = input?.month ?? valuation;
    if (month > valuation) throw new HttpError(400, "month is after the valuation month");
    if ((await read(month))?.source === "saved") {
      throw new HttpError(409, "a saved snapshot already exists for this month");
    }
    const [goals] = await computeMonths(db, today(), [month]);
    await store(db, month, "saved", await assumptionsHash(db), goals as SnapshotGoal[]);
    return read(month);
  });

  router.route("DELETE", "/api/snapshots", idQuery, async ({ id }) => {
    const snapshot = await read(id);
    if (!snapshot) throw new HttpError(404, "snapshot not found");
    if (snapshot.source !== "saved") {
      throw new HttpError(409, "only a saved snapshot can be deleted");
    }
    await db.deleteFrom("snapshot").where("month", "=", id).where("source", "=", "saved").execute();
    return { id };
  });
}
