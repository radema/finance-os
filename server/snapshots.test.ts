import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Settings } from "../engine/schemas.ts";
import type { DB } from "./db.ts";
import { DATABASE_FILE, openDatabase } from "./db.ts";
import { startServer } from "./index.ts";
import type { SnapshotView } from "./snapshots.ts";
import { ensureSnapshots } from "./snapshots.ts";

// The sample data has prices to 2026-10 and four goals. The clock starts at 2026-10-31.
describe("Snapshots", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;
  let db: Kysely<DB>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-snapshots-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
    db = await openDatabase(dataDir);
  });
  afterEach(async () => {
    await db.destroy();
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const list = async () => (await call<SnapshotView[]>("GET", "/api/snapshots")).body;
  const rawResults = (month: string) => {
    const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
    const row = database
      .prepare("SELECT source, assumptions_hash AS hash, results FROM snapshot WHERE month = ?")
      .get(month) as { source: string; hash: string; results: string } | undefined;
    database.close();
    return row;
  };
  const withSample = async (trackingStart: string) => {
    await call("POST", "/api/sample-data");
    const settings = (await call<Settings>("GET", "/api/settings")).body;
    await call("PUT", "/api/settings", { ...settings, trackingStart });
  };

  it("saves the previous month and recomputes the older missing ones, 3 months on", async () => {
    await withSample("2026-09");
    expect(await ensureSnapshots(db, "2027-01-31")).toEqual({
      saved: ["2026-12"],
      recomputed: ["2026-09", "2026-10", "2026-11"],
    });
    const snapshots = await list();
    expect(snapshots.map((s) => [s.month, s.source])).toEqual([
      ["2026-09", "recomputed"],
      ["2026-10", "recomputed"],
      ["2026-11", "recomputed"],
      ["2026-12", "saved"],
    ]);
    const december = snapshots[3] as SnapshotView;
    expect(december.goals).toHaveLength(4);
    // Every goal of the sample has prices, so every analysis ran.
    for (const goal of december.goals) {
      expect(goal.prob).toBeGreaterThanOrEqual(0);
      expect(goal.prob).toBeLessThanOrEqual(1);
      expect(goal.status).not.toBeNull();
      expect(goal.p10 ?? 0).toBeLessThanOrEqual(goal.median ?? 0);
    }
    // Nothing is missing any more.
    expect(await ensureSnapshots(db, "2027-01-31")).toEqual({ saved: [], recomputed: [] });
  });

  it("does not change a saved snapshot when an assumption changes", async () => {
    await withSample("2026-11");
    await ensureSnapshots(db, "2027-01-31");
    const before = rawResults("2026-12");
    expect(before?.source).toBe("saved");

    const settings = (await call<Settings>("GET", "/api/settings")).body;
    await call("PUT", "/api/settings", { ...settings, inflation: 0.05, seed: 99 });
    // A month later the catch-up runs again and fills in the new gap with the new assumptions.
    expect(await ensureSnapshots(db, "2027-02-28")).toEqual({
      saved: ["2027-01"],
      recomputed: [],
    });
    expect(rawResults("2026-12")).toEqual(before);
    const january = rawResults("2027-01");
    expect(january?.hash).not.toBe(before?.hash);
  });

  it("gives the same assumptions hash while no assumption changes", async () => {
    await withSample("2026-11");
    await ensureSnapshots(db, "2027-01-31");
    await ensureSnapshots(db, "2027-02-28");
    expect(rawResults("2026-12")?.hash).toBe(rawResults("2027-01")?.hash);
  });

  it("saves one by hand for the valuation month, and not twice", async () => {
    await withSample("2026-09");
    await ensureSnapshots(db, "2026-11-30");
    expect(rawResults("2026-10")?.source).toBe("saved");
    // The valuation month is the last month with prices: 2026-10, already saved by the catch-up.
    expect((await call("POST", "/api/snapshots")).status).toBe(409);

    expect((await call("DELETE", "/api/snapshots?id=2026-10")).status).toBe(200);
    const saved = await call<SnapshotView>("POST", "/api/snapshots");
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ month: "2026-10", source: "saved" });
    expect(saved.body.goals).toHaveLength(4);
    expect(rawResults("2026-10")?.source).toBe("saved");
  });

  it("replaces a recomputed snapshot of the month when it is saved by hand", async () => {
    await withSample("2026-08");
    await ensureSnapshots(db, "2026-11-30");
    expect(rawResults("2026-09")?.source).toBe("recomputed");
    const saved = await call<SnapshotView>("POST", "/api/snapshots", { month: "2026-09" });
    expect(saved.body).toMatchObject({ month: "2026-09", source: "saved" });
    expect((await list()).filter((s) => s.month === "2026-09")).toHaveLength(1);
  });

  it("refuses a month after the valuation month", async () => {
    await withSample("2026-09");
    expect((await call("POST", "/api/snapshots", { month: "2026-11" })).status).toBe(400);
    expect((await call("POST", "/api/snapshots", { month: "nope" })).status).toBe(400);
  });

  it("deletes a saved snapshot, and only a saved one", async () => {
    await withSample("2026-08");
    await ensureSnapshots(db, "2026-11-30");
    expect((await call("DELETE", "/api/snapshots?id=2026-10")).status).toBe(200);
    expect((await list()).map((s) => s.month)).toEqual(["2026-08", "2026-09"]);
    expect((await call("DELETE", "/api/snapshots?id=2026-09")).status).toBe(409);
    expect((await call("DELETE", "/api/snapshots?id=2020-01")).status).toBe(404);
    expect((await list()).map((s) => s.month)).toEqual(["2026-08", "2026-09"]);
  });

  it("does nothing before the tracking start", async () => {
    await withSample("2027-03");
    expect(await ensureSnapshots(db, "2027-02-15")).toEqual({ saved: [], recomputed: [] });
    expect(await list()).toEqual([]);
  });
});
