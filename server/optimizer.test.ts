import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MixView, OptimizerRunView } from "../engine/optimizerView.ts";
import { startServer } from "./index.ts";

describe("Optimizer run API (AC-84)", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-optimizer-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
    await fetch(`${url}/api/sample-data`, { method: "POST" });
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const run = async (body: unknown) => {
    const response = await fetch(`${url}/api/optimizer/run`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: (await response.json()) as OptimizerRunView & { error?: string },
    };
  };

  // Sample goal g-car holds World ETF 60, Direct 20, Govt 20.
  const carUniverse = ["p-world-etf", "p-direct", "p-govt"];
  const car = (extra: object = {}) => ({
    goalId: "g-car",
    products: carUniverse,
    mode: "new",
    criterion: "O1",
    ...extra,
  });
  const weightOf = (mix: MixView, productId: string) =>
    mix.weights.find((row) => row.productId === productId)?.weight;

  it("returns the chosen mix, every candidate, the top mixes and the rule that chose it", async () => {
    const { status, body } = await run(car());
    expect(status).toBe(200);
    // 1 to 3 products in 10% steps: C(12, 2) = 66 mixes.
    expect(body.mixes).toHaveLength(66);
    expect(body.mode).toBe("new");
    expect(body.switchTax).toBe(0);
    expect(body.ruleName).toBe("O1 Protect the bad case");
    expect(body.ruleText).toContain("Highest bad case");
    expect(body.requiredP).toBeGreaterThan(0);
    expect(body.requiredP).toBeLessThanOrEqual(1);
    // Weights are an array of numbers that sum to 1, not a Map that serialises to {}.
    const sum = body.chosen.weights.reduce((total, row) => total + row.weight, 0);
    expect(sum).toBeCloseTo(1, 9);
    expect(body.top).toHaveLength(10);
    expect(body.top[0]).toEqual(body.chosen);
  });

  it("runs the bucket as it is on the same shocks: the current mix equals the same candidate", async () => {
    const { body } = await run(car());
    expect(weightOf(body.current, "p-world-etf")).toBeCloseTo(0.6, 9);
    expect(weightOf(body.current, "p-direct")).toBeCloseTo(0.2, 9);
    const same = body.mixes.find(
      (mix) =>
        Math.abs((weightOf(mix, "p-world-etf") ?? 0) - 0.6) < 1e-9 &&
        Math.abs((weightOf(mix, "p-direct") ?? 0) - 0.2) < 1e-9,
    );
    expect(same).toBeDefined();
    expect(body.current.p).toBe(same?.p);
    expect(body.current.median).toBe(same?.median);
  });

  it("in rebalance mode returns the tax of selling the holdings", async () => {
    const { status, body } = await run(car({ mode: "rebalance" }));
    expect(status).toBe(200);
    expect(body.mode).toBe("rebalance");
    expect(body.switchTax).toBeGreaterThan(0);
  });

  it("caps a product's weight", async () => {
    const { body } = await run(car({ maxPerProduct: 0.5 }));
    expect(body.mixes.length).toBeGreaterThan(0);
    for (const mix of body.mixes) {
      for (const row of mix.weights) expect(row.weight).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it("refuses rebalance mode for the pension goal with a 400", async () => {
    const { status, body } = await run({
      goalId: "g-retirement",
      products: ["p-pension-balanced", "p-pension-equity"],
      mode: "rebalance",
      criterion: "O2",
    });
    expect(status).toBe(400);
    expect(body.error).toContain("pension");
  });

  it.each([
    ["an unknown goal", car({ goalId: "nope" }), 404],
    ["a product that does not exist", car({ products: ["p-world-etf", "nope"] }), 404],
    ["a product listed twice", car({ products: ["p-world-etf", "p-world-etf"] }), 400],
    ["a pension fund on another goal", car({ products: ["p-world-etf", "p-pension-equity"] }), 400],
    ["no product", car({ products: [] }), 400],
    ["seven products", car({ products: ["a", "b", "c", "d", "e", "f", "g"] }), 400],
    ["a cap that leaves no mix", car({ maxPerProduct: 0.3 }), 400],
    ["an unknown criterion", car({ criterion: "O3" }), 400],
    ["an unknown mode", car({ mode: "sell" }), 400],
  ])("answers %s with a 4xx", async (_name, body, expected) => {
    const result = await run(body);
    expect(result.status).toBe(expected);
    expect(result.body.error).toBeTruthy();
  });
});
