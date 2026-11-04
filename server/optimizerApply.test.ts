import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AllocationRow, PensionPlan } from "../engine/schemas.ts";
import { startServer } from "./index.ts";

type Applied = {
  preview?: { weights: { productId: string; weight: number }[]; flows?: unknown[] };
  applied?: { weights: { productId: string; weight: number }[]; flows?: unknown[] };
};

describe("Optimizer apply API (AC-82)", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-apply-"));
    const server = await startServer({ dataDir, port: 0, today: "2026-10-31" });
    stop = server.close;
    url = server.url;
    await call("POST", "/api/sample-data");
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as T };
  };
  const stored = async () => (await call<AllocationRow[]>("GET", "/api/allocation")).body;
  const plan = async () => (await call<PensionPlan>("GET", "/api/pension-plan")).body;
  const apply = (body: unknown) =>
    call<Applied & { error?: string }>("POST", "/api/optimizer/apply", body);

  // Sample goal g-car holds World ETF 60, Direct 20, Govt 20.
  const carMix = [
    { productId: "p-world-etf", weight: 0.5 },
    { productId: "p-govt", weight: 0.3 },
    { productId: "p-mixed-etf", weight: 0.2 },
    { productId: "p-direct", weight: 0 },
  ];

  it("without confirm returns the weights that would be written and changes nothing", async () => {
    const before = await stored();
    const result = await apply({ goalId: "g-car", weights: carMix, confirm: false });
    expect(result.status).toBe(200);
    expect(result.body.applied).toBeUndefined();
    expect(result.body.preview?.weights).toEqual([
      { productId: "p-world-etf", weight: 0.5 },
      { productId: "p-govt", weight: 0.3 },
      { productId: "p-mixed-etf", weight: 0.2 },
    ]);
    expect(await stored()).toEqual(before);
  });

  it("with confirm replaces the goal's weights, rescaled to 100%, and leaves other goals alone", async () => {
    const before = await stored();
    const result = await apply({
      goalId: "g-car",
      weights: carMix.map((row) => ({ ...row, weight: row.weight * 5 })),
      confirm: true,
    });
    expect(result.status).toBe(200);
    expect(result.body.preview).toBeUndefined();
    const car = (await stored()).filter((row) => row.goalId === "g-car");
    expect(car.map(({ productId, weight }) => [productId, weight]).sort()).toEqual([
      ["p-govt", 0.3],
      ["p-mixed-etf", 0.2],
      ["p-world-etf", 0.5],
    ]);
    expect(result.body.applied?.weights).toHaveLength(3);
    const others = (rows: AllocationRow[]) => rows.filter((row) => row.goalId !== "g-car");
    expect(others(await stored())).toEqual(others(before));
  });

  it("on the pension goal changes only the plan flows, never the AllocationWeight rows", async () => {
    const before = await stored();
    const planBefore = await plan();
    const mix = [
      { productId: "p-pension-balanced", weight: 3 },
      { productId: "p-pension-equity", weight: 1 },
    ];
    const preview = await apply({ goalId: "g-retirement", weights: mix, confirm: false });
    expect(preview.status).toBe(200);
    expect(await plan()).toEqual(planBefore);

    const result = await apply({ goalId: "g-retirement", weights: mix, confirm: true });
    expect(result.status).toBe(200);
    expect(await stored()).toEqual(before);
    const after = await plan();
    expect(after.flows).not.toEqual(planBefore.flows);
    expect(after.flows).toEqual([
      { productId: "p-pension-balanced", flow: "Work", pct: 0.75 },
      { productId: "p-pension-equity", flow: "Work", pct: 0.25 },
      { productId: "p-pension-balanced", flow: "Voluntary", pct: 0.75 },
      { productId: "p-pension-equity", flow: "Voluntary", pct: 0.25 },
    ]);
    expect({ ...after, flows: [] }).toEqual({ ...planBefore, flows: [] });
  });

  it("refuses a non-pension product on the pension goal", async () => {
    const result = await apply({
      goalId: "g-retirement",
      weights: [{ productId: "p-world-etf", weight: 1 }],
      confirm: true,
    });
    expect(result.status).toBe(400);
  });

  it("refuses an unknown goal, an unknown product, bad weights and a missing confirm flag", async () => {
    const one = [{ productId: "p-govt", weight: 1 }];
    expect((await apply({ goalId: "nope", weights: one, confirm: true })).status).toBe(404);
    const ghost = [{ productId: "nope", weight: 1 }];
    expect((await apply({ goalId: "g-car", weights: ghost, confirm: true })).status).toBe(404);
    const zero = [{ productId: "p-govt", weight: 0 }];
    expect((await apply({ goalId: "g-car", weights: zero, confirm: true })).status).toBe(400);
    const twice = [...one, ...one];
    expect((await apply({ goalId: "g-car", weights: twice, confirm: true })).status).toBe(400);
    expect((await apply({ goalId: "g-car", weights: [], confirm: true })).status).toBe(400);
    expect((await apply({ goalId: "g-car", weights: one })).status).toBe(400);
  });
});
