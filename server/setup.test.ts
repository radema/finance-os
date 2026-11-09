import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planInForce } from "../engine/plan.ts";
import type { AllocationRow, Goal, Product } from "../engine/schemas.ts";
import { DEFAULT_CORRELATIONS } from "../engine/schemas.ts";
import { DATABASE_FILE } from "./db.ts";
import { startServer } from "./index.ts";

const PRODUCT = {
  name: "VWCE",
  isin: "IE00BK5BQT80",
  assetClass: "Equity",
  regime: "etf",
  expReturn: 0.065,
  volatility: 0.16,
  ter: 0.0019,
};
const GOAL = {
  name: "Home",
  priority: "Need",
  targetCents: 5_000_000,
  targetYear: 2032,
  contributionGrowth: 0.02,
};

describe("Setup API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-setup-"));
    const server = await startServer({ dataDir, port: 0 });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T = unknown>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const createProduct = async (overrides = {}) =>
    (await call<Product>("POST", "/api/products", { ...PRODUCT, ...overrides })).body;
  const createGoal = async (overrides = {}) =>
    (await call<Goal>("POST", "/api/goals", { ...GOAL, ...overrides })).body;

  describe("products", () => {
    it("creates, lists, edits and deletes", async () => {
      const created = await call<Product>("POST", "/api/products", PRODUCT);
      expect(created.status).toBe(200);
      expect(created.body).toMatchObject({
        ...PRODUCT,
        whiteListShare: 0,
        couponRate: 0,
        zeroCommission: false,
        priceSource: "manual",
        maturity: null,
      });

      const edited = await call<Product>("PUT", "/api/products", {
        ...PRODUCT,
        id: created.body.id,
        name: "VWCE (acc)",
        zeroCommission: true,
      });
      expect(edited.body).toMatchObject({
        id: created.body.id,
        name: "VWCE (acc)",
        zeroCommission: true,
      });

      const list = await call<Product[]>("GET", "/api/products");
      expect(list.body).toEqual([edited.body]);

      expect((await call("DELETE", `/api/products?id=${created.body.id}`)).status).toBe(200);
      expect((await call<Product[]>("GET", "/api/products")).body).toEqual([]);
    });

    it("rejects a negative rate, an unknown asset class and a missing product", async () => {
      expect((await call("POST", "/api/products", { ...PRODUCT, ter: -0.01 })).status).toBe(400);
      expect((await call("POST", "/api/products", { ...PRODUCT, volatility: -1 })).status).toBe(
        400,
      );
      expect(
        (await call("POST", "/api/products", { ...PRODUCT, assetClass: "Crypto" })).status,
      ).toBe(400);
      expect((await call("PUT", "/api/products", { ...PRODUCT, id: "nope" })).status).toBe(404);
      expect((await call("DELETE", "/api/products?id=nope")).status).toBe(404);
    });

    it("refuses to delete a product that an allocation weight uses", async () => {
      const product = await createProduct();
      const goal = await createGoal();
      await call("PUT", "/api/allocation", { goalId: goal.id, productId: product.id, weight: 1 });
      const refused = await call<{ error: string }>("DELETE", `/api/products?id=${product.id}`);
      expect(refused.status).toBe(409);
      expect(refused.body.error).toContain("1 allocation weight");
      expect((await call<Product[]>("GET", "/api/products")).body).toHaveLength(1);
    });
  });

  describe("goals", () => {
    it("creates, lists, edits and deletes", async () => {
      const created = await call<Goal>("POST", "/api/goals", GOAL);
      expect(created.body).toMatchObject({
        ...GOAL,
        minProb: null,
        countsTowardFi: false,
        plan: [],
      });

      const edited = await call<Goal>("PUT", "/api/goals", {
        ...GOAL,
        id: created.body.id,
        priority: "Wish",
        minProb: 0.6,
        countsTowardFi: true,
      });
      expect(edited.body).toMatchObject({ priority: "Wish", minProb: 0.6, countsTowardFi: true });
      expect((await call<Goal[]>("GET", "/api/goals")).body).toEqual([
        { ...edited.body, archived: false },
      ]);

      expect((await call("DELETE", `/api/goals?id=${created.body.id}`)).status).toBe(200);
      expect((await call<Goal[]>("GET", "/api/goals")).body).toEqual([]);
    });

    it("rejects a probability outside 0-100% and a negative growth", async () => {
      expect((await call("POST", "/api/goals", { ...GOAL, minProb: 1.2 })).status).toBe(400);
      expect(
        (await call("POST", "/api/goals", { ...GOAL, contributionGrowth: -0.01 })).status,
      ).toBe(400);
    });

    it("deletes the weights and plan versions of a deleted goal", async () => {
      const product = await createProduct();
      const goal = await createGoal();
      await call("PUT", "/api/allocation", { goalId: goal.id, productId: product.id, weight: 1 });
      await call("PUT", "/api/goal-plan", {
        goalId: goal.id,
        fromMonth: "2026-01",
        monthlyCents: 10_000,
      });
      await call("DELETE", `/api/goals?id=${goal.id}`);
      expect((await call<AllocationRow[]>("GET", "/api/allocation")).body).toEqual([]);
      // With the weight gone the product can go too.
      expect((await call("DELETE", `/api/products?id=${product.id}`)).status).toBe(200);
    });

    it("keeps a plan version in force from its month only", async () => {
      const goal = await createGoal();
      const save = (fromMonth: string, monthlyCents: number) =>
        call("PUT", "/api/goal-plan", { goalId: goal.id, fromMonth, monthlyCents });
      await save("2026-01", 10_000);
      await save("2026-07", 15_000);

      const [stored] = (await call<Goal[]>("GET", "/api/goals")).body;
      const versions = (stored as Goal).plan.map((v) => ({
        fromMonth: v.fromMonth,
        monthly: v.monthlyCents,
      }));
      expect(versions).toEqual([
        { fromMonth: "2026-01", monthly: 10_000 },
        { fromMonth: "2026-07", monthly: 15_000 },
      ]);
      expect(planInForce(versions, "2026-06")).toBe(10_000);
      expect(planInForce(versions, "2026-07")).toBe(15_000);
      expect(planInForce(versions, "2025-12")).toBe(0);

      // Saving the same month again replaces that version; deleting one removes it.
      await save("2026-07", 20_000);
      const afterEdit = (
        await call<{ fromMonth: string; monthlyCents: number }[]>("PUT", "/api/goal-plan", {
          goalId: goal.id,
          fromMonth: "2026-07",
          monthlyCents: 20_000,
        })
      ).body;
      expect(afterEdit.map((v) => v.monthlyCents)).toEqual([10_000, 20_000]);
      const afterDelete = await call<unknown[]>(
        "DELETE",
        `/api/goal-plan?goalId=${goal.id}&fromMonth=2026-07`,
      );
      expect(afterDelete.body).toHaveLength(1);
      expect(
        (await call("DELETE", `/api/goal-plan?goalId=${goal.id}&fromMonth=2026-07`)).status,
      ).toBe(404);
    });

    it("rejects a bad month and an unknown goal in the plan", async () => {
      const goal = await createGoal();
      expect(
        (
          await call("PUT", "/api/goal-plan", {
            goalId: goal.id,
            fromMonth: "2026-13",
            monthlyCents: 1,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call("PUT", "/api/goal-plan", {
            goalId: "nope",
            fromMonth: "2026-01",
            monthlyCents: 1,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe("allocation", () => {
    it("rescales weights 2, 1, 1 to shares of 50%, 25% and 25%", async () => {
      const goal = await createGoal();
      const products = [
        await createProduct({ name: "A" }),
        await createProduct({ name: "B" }),
        await createProduct({ name: "C" }),
      ];
      let rows: AllocationRow[] = [];
      for (const [i, weight] of [2, 1, 1].entries()) {
        rows = (
          await call<AllocationRow[]>("PUT", "/api/allocation", {
            goalId: goal.id,
            productId: (products[i] as Product).id,
            weight,
          })
        ).body;
      }
      expect(rows.map((r) => [r.weight, r.share])).toEqual([
        [2, 0.5],
        [1, 0.25],
        [1, 0.25],
      ]);
      expect(rows.reduce((sum, r) => sum + r.share, 0)).toBe(1);
    });

    it("edits and deletes a weight, and keeps goals apart", async () => {
      const [g1, g2] = [await createGoal({ name: "One" }), await createGoal({ name: "Two" })] as [
        Goal,
        Goal,
      ];
      const [a, b] = [await createProduct({ name: "A" }), await createProduct({ name: "B" })] as [
        Product,
        Product,
      ];
      const put = (goalId: string, productId: string, weight: number) =>
        call<AllocationRow[]>("PUT", "/api/allocation", { goalId, productId, weight });
      await put(g1.id, a.id, 1);
      await put(g1.id, b.id, 3);
      await put(g2.id, a.id, 5);

      const edited = (await put(g1.id, a.id, 1.5)).body;
      expect(edited.map((r) => r.weight)).toEqual([1.5, 3]);
      expect(edited.map((r) => r.share)).toEqual([1.5 / 4.5, 3 / 4.5]);

      const afterDelete = await call<AllocationRow[]>(
        "DELETE",
        `/api/allocation?goalId=${g1.id}&productId=${a.id}`,
      );
      expect(afterDelete.body).toEqual([{ goalId: g1.id, productId: b.id, weight: 3, share: 1 }]);
      const all = (await call<AllocationRow[]>("GET", "/api/allocation")).body;
      expect(all.find((r) => r.goalId === g2.id)?.share).toBe(1);
      expect(
        (await call("DELETE", `/api/allocation?goalId=${g1.id}&productId=${a.id}`)).status,
      ).toBe(404);
    });

    it("gives all-zero weights a share of 0 and rejects a negative weight", async () => {
      const goal = await createGoal();
      const product = await createProduct();
      const rows = (
        await call<AllocationRow[]>("PUT", "/api/allocation", {
          goalId: goal.id,
          productId: product.id,
          weight: 0,
        })
      ).body;
      expect(rows[0]?.share).toBe(0);
      const negative = await call("PUT", "/api/allocation", {
        goalId: goal.id,
        productId: product.id,
        weight: -1,
      });
      expect(negative.status).toBe(400);
    });
  });

  describe("assumptions", () => {
    it("serves the defaults when nothing is saved", async () => {
      const settings = (await call("GET", "/api/settings")).body;
      expect(settings).toMatchObject({
        inflation: 0.02,
        taxStd: 0.26,
        taxGovt: 0.125,
        bollo: 0.002,
        pensionTax: 0.2,
        requiredProb: { need: 0.9, want: 0.75, wish: 0.5 },
        mcPaths: 1000,
        seed: 42,
        zainetto: { amountCents: 0, goalId: null },
        pensionDeductionCapCents: 530_000,
        thresholds: {
          r1Months: 3,
          r3Months: 36,
          r7Multiple: 1.25,
          statusBandPoints: 15,
          dailyPriceAgeDays: 7,
        },
      });
      expect((await call("GET", "/api/commission")).body).toEqual({
        plan: "Fineco Trading",
        feeModel: "percent",
        rate: 0.0019,
        minCents: 295,
        maxCents: 1900,
        flatFeeCents: 0,
        minTicketCents: 0,
      });
      expect((await call("GET", "/api/correlations")).body).toEqual({
        matrix: DEFAULT_CORRELATIONS,
        effective: DEFAULT_CORRELATIONS,
        shrunk: false,
      });
    });

    it("saves and loads the commission plan name and the fee model", async () => {
      const flat = {
        plan: "Directa",
        feeModel: "flat",
        rate: 0.0019,
        minCents: 295,
        maxCents: 1900,
        flatFeeCents: 500,
        minTicketCents: 100_000,
      };
      expect((await call("PUT", "/api/commission", flat)).status).toBe(200);
      expect((await call("GET", "/api/commission")).body).toEqual(flat);
      expect((await call("PUT", "/api/commission", { ...flat, feeModel: "tiered" })).status).toBe(
        400,
      );
    });

    it("saves settings, rejects bad bounds, and refuses an unknown zainetto goal", async () => {
      const goal = await createGoal();
      const defaults = (await call<Record<string, unknown>>("GET", "/api/settings")).body;
      const saved = {
        ...defaults,
        inflation: 0.03,
        zainetto: { amountCents: 100_000, expiry: 2030, goalId: goal.id },
      };
      expect((await call("PUT", "/api/settings", saved)).status).toBe(200);
      expect((await call("GET", "/api/settings")).body).toEqual(saved);

      expect((await call("PUT", "/api/settings", { ...saved, inflation: -0.01 })).status).toBe(400);
      expect(
        (await call("PUT", "/api/settings", { ...saved, requiredProb: { need: 1.5 } })).status,
      ).toBe(400);
      const unknown = { ...saved, zainetto: { ...(saved.zainetto as object), goalId: "nope" } };
      expect((await call("PUT", "/api/settings", unknown)).status).toBe(400);
    });

    it("clears the zainetto goal when that goal is deleted", async () => {
      const goal = await createGoal();
      const defaults = (await call<{ zainetto: object }>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", {
        ...defaults,
        zainetto: { ...defaults.zainetto, goalId: goal.id },
      });
      await call("DELETE", `/api/goals?id=${goal.id}`);
      expect(
        (await call<{ zainetto: { goalId: unknown } }>("GET", "/api/settings")).body.zainetto
          .goalId,
      ).toBeNull();
    });

    it("leaves the settings alone when the deleted goal is not the zainetto goal", async () => {
      const linked = await createGoal();
      const other = await createGoal({ name: "Car" });
      const defaults = (await call<{ zainetto: object }>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", {
        ...defaults,
        zainetto: { ...defaults.zainetto, goalId: linked.id },
      });
      const before = (await call("GET", "/api/settings")).body;
      expect((await call("DELETE", `/api/goals?id=${other.id}`)).status).toBe(200);
      expect((await call("GET", "/api/settings")).body).toEqual(before);
    });

    it("keeps the goal when the settings write fails during its delete", async () => {
      const goal = await createGoal();
      const defaults = (await call<{ zainetto: object }>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", {
        ...defaults,
        zainetto: { ...defaults.zainetto, goalId: goal.id },
      });
      const database = new DatabaseSync(join(dataDir, DATABASE_FILE));
      database.exec(
        "CREATE TRIGGER fail_document_write BEFORE UPDATE ON document BEGIN SELECT RAISE(ABORT, 'write failed'); END",
      );
      database.close();
      expect((await call("DELETE", `/api/goals?id=${goal.id}`)).status).toBe(500);
      expect((await call<Goal[]>("GET", "/api/goals")).body.map((g) => g.id)).toEqual([goal.id]);
    });

    it("rejects an asymmetric correlation matrix and keeps the stored one symmetric", async () => {
      const asymmetric = DEFAULT_CORRELATIONS.map((row) => [...row]);
      (asymmetric[0] as number[])[1] = 0.5;
      expect((await call("PUT", "/api/correlations", { matrix: asymmetric })).status).toBe(400);

      const symmetric = DEFAULT_CORRELATIONS.map((row) => [...row]);
      (symmetric[0] as number[])[1] = 0.5;
      (symmetric[1] as number[])[0] = 0.5;
      const saved = await call<{ matrix: number[][]; shrunk: boolean }>(
        "PUT",
        "/api/correlations",
        { matrix: symmetric },
      );
      expect(saved.status).toBe(200);
      const { matrix } = (await call<{ matrix: number[][] }>("GET", "/api/correlations")).body;
      expect(matrix).toEqual(symmetric);
      expect(matrix.every((row, i) => row.every((v, j) => v === matrix[j]?.[i]))).toBe(true);
    });

    it("rejects a matrix with a diagonal other than 1 or a value outside -1 to 1", async () => {
      const off = DEFAULT_CORRELATIONS.map((row) => [...row]);
      (off[2] as number[])[2] = 0.9;
      expect((await call("PUT", "/api/correlations", { matrix: off })).status).toBe(400);
      const wild = DEFAULT_CORRELATIONS.map((row) => [...row]);
      (wild[0] as number[])[1] = 1.5;
      (wild[1] as number[])[0] = 1.5;
      expect((await call("PUT", "/api/correlations", { matrix: wild })).status).toBe(400);
    });

    it("shrinks a matrix that is not positive definite and flags it", async () => {
      const bad = DEFAULT_CORRELATIONS.map((row) => [...row]);
      // Equity-Govt bonds and Equity-Corp bonds strongly positive, Govt bonds-Corp bonds strongly negative.
      for (const [i, j, v] of [
        [0, 1, 0.9],
        [0, 2, 0.9],
        [1, 2, -0.9],
      ] as const) {
        (bad[i] as number[])[j] = v;
        (bad[j] as number[])[i] = v;
      }
      const view = (
        await call<{ matrix: number[][]; effective: number[][]; shrunk: boolean }>(
          "PUT",
          "/api/correlations",
          { matrix: bad },
        )
      ).body;
      expect(view.shrunk).toBe(true);
      expect(view.matrix).toEqual(bad);
      const k = Math.round(
        Math.log(Math.abs((view.effective[0] as number[])[1] as number) / 0.9) / Math.log(0.9),
      );
      expect(k).toBeGreaterThan(0);
      expect((view.effective[0] as number[])[1]).toBeCloseTo(0.9 * 0.9 ** k, 12);
      expect((view.effective[0] as number[])[0]).toBe(1);
    });

    it("resets the assumption documents but leaves products and goals", async () => {
      await createProduct();
      await createGoal();
      const defaults = (await call<Record<string, unknown>>("GET", "/api/settings")).body;
      await call("PUT", "/api/settings", { ...defaults, inflation: 0.05 });
      await call("PUT", "/api/commission", { plan: "Other", feeModel: "flat", flatFeeCents: 400 });

      const reset = await call<{ settings: { inflation: number }; commission: { plan: string } }>(
        "POST",
        "/api/assumptions/reset",
        {},
      );
      expect(reset.body.settings.inflation).toBe(0.02);
      expect(reset.body.commission.plan).toBe("Fineco Trading");
      expect((await call<unknown[]>("GET", "/api/products")).body).toHaveLength(1);
      expect((await call<unknown[]>("GET", "/api/goals")).body).toHaveLength(1);
    });
  });
});
