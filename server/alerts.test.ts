import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Alert } from "../engine/rules.ts";
import { computeSnapshot } from "../engine/snapshot.ts";
import type { DB } from "./db.ts";
import { openDatabase } from "./db.ts";
import { loadWorld } from "./goalViews.ts";
import { startServer } from "./index.ts";

// The sample data has prices to 2026-10, four goals and the clock at 2026-10-31. It already fires
// R2, R3 and R7. Each case below makes one more alert true, or changes the key of one.
describe("Alerts and dismissals", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;
  let db: Kysely<DB>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-alerts-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
    db = await openDatabase(dataDir);
    await fetch(`${url}/api/sample-data`, { method: "POST" });
  });
  afterEach(async () => {
    await db.destroy();
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const alerts = async () => (await (await fetch(`${url}/api/alerts`)).json()) as Alert[];
  const find = async (ruleId: string, key: string) =>
    (await alerts()).find((alert) => alert.ruleId === ruleId && alert.key === key);
  const dismiss = (alert: Pick<Alert, "ruleId" | "key"> & { scope: { kind: string } }) =>
    fetch(`${url}/api/alerts/dismiss`, {
      method: "POST",
      body: JSON.stringify({ ruleId: alert.ruleId, scope: alert.scope.kind, key: alert.key }),
    });
  const dismissals = () => db.selectFrom("dismissal").selectAll().execute();

  const setPrice = (productId: string, month: string) =>
    db
      .insertInto("pricePoint")
      .values({
        productId,
        month,
        priceScaled: 100_000_000,
        priceDate: `${month}-15`,
        source: "manual",
        fetchedAt: "2026-10-31T12:00:00Z",
        importBatchId: null,
      })
      .execute();
  const buy = (id: string, date: string, goalId: string, productId: string, commission: number) =>
    db
      .insertInto("transaction")
      .values({
        id,
        date,
        goalId,
        productId,
        type: "buy",
        qtyScaled: 5_000_000,
        priceScaled: 100_000_000,
        commissionCents: commission,
        amountCents: 50_000,
        note: "",
        importBatchId: null,
        flow: null,
      })
      .execute();
  const setProduct = (id: string, values: Partial<DB["product"]>) =>
    db.updateTable("product").set(values).where("id", "=", id).execute();
  const dropPrice = (productId: string, month: string) =>
    db
      .deleteFrom("pricePoint")
      .where("productId", "=", productId)
      .where("month", "=", month)
      .execute();
  const setFetchErrors = (productIds: string[]) =>
    db
      .insertInto("meta")
      .values({
        key: "priceFetch",
        value: JSON.stringify({
          errors: productIds.map((productId) => ({ productId, message: "down" })),
        }),
      })
      .onConflict((conflict) =>
        conflict.column("key").doUpdateSet((eb) => ({ value: eb.ref("excluded.value") })),
      )
      .execute();
  const worsenGoal = (goalId: string) =>
    db
      .updateTable("goal")
      .set((eb) => ({ targetCents: eb("targetCents", "*", 100) }))
      .where("id", "=", goalId)
      .execute();

  type Case = {
    name: string;
    ruleId: string;
    key: string;
    nextKey: string;
    /** Makes the alert true, if the sample does not already. */
    setup?: () => Promise<unknown>;
    /** Changes what the key is made of, keeping the condition true. */
    change: () => Promise<unknown>;
  };
  const cases: Case[] = [
    {
      name: "R1 goal + month",
      ruleId: "R1",
      key: "g-car|2026-10",
      nextKey: "g-car|2026-11",
      setup: () =>
        db
          .updateTable("contributionPlan")
          .set({ monthlyCents: 400_000 })
          .where("goalId", "=", "g-car")
          .execute(),
      change: () => setPrice("p-world-etf", "2026-11"),
    },
    {
      name: "R2 year",
      ruleId: "R2",
      key: "2026",
      nextKey: "2027",
      change: () => setPrice("p-world-etf", "2027-01"),
    },
    {
      name: "R3 product + maturity",
      ruleId: "R3",
      key: "p-govt|2029-06",
      nextKey: "p-govt|2029-05",
      change: () => setProduct("p-govt", { maturity: "2029-05" }),
    },
    {
      name: "R4 goal + new status",
      ruleId: "R4",
      key: "g-retirement|at_risk",
      nextKey: "g-retirement|off_track",
      setup: async () => {
        const results = ["g-holiday", "g-car", "g-home", "g-retirement"].map((goalId) => ({
          goalId,
          status: "on_track",
        }));
        await db
          .insertInto("snapshot")
          .values({
            month: "2026-09",
            source: "saved",
            assumptionsHash: "x",
            results: JSON.stringify(results),
          })
          .execute();
      },
      change: () => worsenGoal("g-retirement"),
    },
    {
      name: "R5 product set",
      ruleId: "R5",
      key: "p-world-etf",
      nextKey: "p-direct,p-world-etf",
      setup: () => dropPrice("p-world-etf", "2026-09"),
      change: () => dropPrice("p-direct", "2026-09"),
    },
    {
      name: "R7 latest costly trade",
      ruleId: "R7",
      key: "",
      nextKey: "costly-2",
      change: () => buy("costly-2", "2026-10-20", "g-car", "p-world-etf", 295),
    },
    {
      name: "R8 goal",
      ruleId: "R8",
      key: "g-holiday",
      nextKey: "g-car",
      setup: () => buy("equity-1", "2026-10-20", "g-holiday", "p-world-etf", 0),
      change: () =>
        db.updateTable("goal").set({ targetYear: 2026 }).where("id", "=", "g-car").execute(),
    },
    {
      name: "R9 product + units pair",
      ruleId: "R9",
      key: "p-world-etf|50000000|999000000",
      nextKey: "p-world-etf|50000000|998000000",
      setup: () =>
        setProduct("p-world-etf", {
          brokerUnitsScaled: 999_000_000,
          brokerUnitsDate: "2026-10-31",
        }),
      change: () => setProduct("p-world-etf", { brokerUnitsScaled: 998_000_000 }),
    },
    {
      name: "R10 product set",
      ruleId: "R10",
      key: "p-world-etf",
      nextKey: "p-direct,p-world-etf",
      setup: async () => {
        await setProduct("p-world-etf", { priceSource: "provider" });
        await setProduct("p-direct", { priceSource: "provider" });
        await setFetchErrors(["p-world-etf"]);
      },
      change: () => setFetchErrors(["p-world-etf", "p-direct"]),
    },
  ];

  it.each(cases)(
    "$name: stays hidden while the key is unchanged, returns when it changes (AC-73)",
    async (c) => {
      await c.setup?.();
      // R7's key is a generated id: read it from the alert.
      const key =
        c.key === "" ? ((await alerts()).find((a) => a.ruleId === c.ruleId)?.key ?? "") : c.key;
      const alert = await find(c.ruleId, key);
      expect(alert, "the alert is visible before the dismissal").toBeDefined();

      expect((await dismiss(alert as Alert)).status).toBe(204);
      expect(await find(c.ruleId, key)).toBeUndefined();
      expect(await find(c.ruleId, key)).toBeUndefined();

      await c.change();
      expect(await find(c.ruleId, c.nextKey), "the alert returns under its new key").toBeDefined();
    },
  );

  it("does not fire R4 when the snapshot of the valuation month and now are the same computation", async () => {
    // At 1,000 paths g-car at 1.29 x its target is At risk, at the 300 paths of a snapshot On track:
    // Monte Carlo noise alone. R4 must compare like with like.
    await db
      .updateTable("goal")
      .set((eb) => ({ targetCents: eb(eb("targetCents", "*", 129), "/", 100) }))
      .where("id", "=", "g-car")
      .execute();
    const world = await loadWorld(db, "2026-10-31");
    const goals = computeSnapshot(world);
    expect(goals.find((goal) => goal.goalId === "g-car")?.status).toBe("on_track");
    await db
      .insertInto("snapshot")
      .values({
        month: world.month,
        source: "saved",
        assumptionsHash: "x",
        results: JSON.stringify(goals),
      })
      .execute();

    expect((await alerts()).filter((alert) => alert.ruleId === "R4")).toEqual([]);
  });

  it("deletes the dismissal when the condition turns false, and shows the alert when it is true again (AC-73)", async () => {
    const alert = (await find("R3", "p-govt|2029-06")) as Alert;
    await dismiss(alert);
    expect(await dismissals()).toHaveLength(1);

    await setProduct("p-govt", { maturity: "2031-06" });
    expect(await find("R3", "p-govt|2029-06")).toBeUndefined();
    expect(await dismissals()).toEqual([]);

    await setProduct("p-govt", { maturity: "2029-06" });
    expect(await find("R3", "p-govt|2029-06")).toBeDefined();
  });

  it("deletes the dismissal of a key that no longer applies", async () => {
    await dismiss((await find("R2", "2026")) as Alert);
    await setPrice("p-world-etf", "2027-01");
    await alerts();
    expect(await dismissals()).toEqual([]);
  });

  it("keeps one row when the same alert is dismissed twice", async () => {
    const alert = (await find("R2", "2026")) as Alert;
    expect((await dismiss(alert)).status).toBe(204);
    expect((await dismiss(alert)).status).toBe(204);
    expect(await dismissals()).toHaveLength(1);
  });

  it("refuses to dismiss an alert that is not true", async () => {
    const response = await dismiss({ ruleId: "R2", key: "1999", scope: { kind: "none" } });
    expect(response.status).toBe(404);
    expect(await dismissals()).toEqual([]);
  });

  it("refuses a body with an unknown scope", async () => {
    const response = await fetch(`${url}/api/alerts/dismiss`, {
      method: "POST",
      body: JSON.stringify({ ruleId: "R2", scope: "team", key: "2026" }),
    });
    expect(response.status).toBe(400);
  });
});
