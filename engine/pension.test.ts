import { describe, expect, it } from "vitest";
import sampleJson from "../fixtures/sample.json" with { type: "json" };
import { pensionFlowsByProduct, pensionSchedule } from "./pension.ts";
import { pensionPlanSchema } from "./schemas.ts";

// Money is in cents: a hand value in euros is written as `eur * 100`.
const eur = (euros: number) => euros * 100;
const settings = { pensionDeductionCapCents: eur(5_300) };

// RAL 40,000 growing 10% a year, TFR 6.91%, worker 1%, employer 2%, cap 5,300 + extra 2,650,
// marginal rate 35%, voluntary blank (to cap).
const plan = pensionPlanSchema.parse({
  goalId: "g-retirement",
  firstYear: 2020,
  ral: eur(40_000),
  ralGrowth: 0.1,
  tfrPct: 0.0691,
  workerPct: 0.01,
  employerPct: 0.02,
  marginalRate: 0.35,
  extra: eur(2_650),
});

describe("pensionPlanSchema", () => {
  it("accepts the partial document of the #23 fixture", () => {
    const parsed = pensionPlanSchema.parse(sampleJson.pensionPlan);
    expect(parsed.goalId).toBe(sampleJson.pensionPlan.goalId);
    expect(parsed.firstYear).toBe(sampleJson.pensionPlan.firstYear);
    expect(parsed.ral).toBeUndefined();
    expect(parsed.voluntary).toBeNull();
    expect(parsed.tfrPct).toBe(0.0691);
    expect(parsed.extra).toBe(eur(2_650));
  });

  it("accepts a full plan", () => {
    const full = {
      goalId: "g",
      firstYear: 2020,
      ral: eur(40_000),
      ralGrowth: 0.02,
      tfrPct: 0.0691,
      workerPct: 0.01,
      employerPct: 0.02,
      voluntary: eur(1_000),
      marginalRate: 0.35,
      extra: eur(2_650),
      flows: [
        { productId: "a", flow: "Work", pct: 1 },
        { productId: "a", flow: "Voluntary", pct: 0.4 },
        { productId: "b", flow: "Voluntary", pct: 0.6 },
      ],
    };
    expect(pensionPlanSchema.parse(full)).toEqual(full);
  });

  it("rejects a bad flow name, a percentage above 100% and a negative RAL", () => {
    const base = { goalId: "g", firstYear: 2020 };
    expect(() =>
      pensionPlanSchema.parse({ ...base, flows: [{ productId: "a", flow: "TFR", pct: 1 }] }),
    ).toThrow();
    expect(() => pensionPlanSchema.parse({ ...base, workerPct: 1.5 })).toThrow();
    expect(() => pensionPlanSchema.parse({ ...base, ral: -1 })).toThrow();
  });
});

describe("pensionSchedule (AC-45)", () => {
  // asOf 2026-06-30: Y0 = 2026, f = 6/12. Voluntary YTD 3,375 = the Y0 stub of 6,750 x 1/2, so
  // the Y0 tax-year voluntary is 6,750 too and every row follows the plain formula.
  const rows = pensionSchedule(plan, settings, "2026-06-30", eur(3_375), 3);

  it("gives one row per year from Y0, with the refund dated t + 1", () => {
    expect(rows.map((row) => row.year)).toEqual([2026, 2027, 2028]);
    expect(rows.map((row) => row.refundYear)).toEqual([2027, 2028, 2029]);
  });

  it("grows RAL and takes TFR, worker and employer from it, year by year", () => {
    const expected = [
      { ral: 40_000, tfr: 2_764, worker: 400, employer: 800 },
      { ral: 44_000, tfr: 3_040.4, worker: 440, employer: 880 },
      { ral: 48_400, tfr: 3_344.44, worker: 484, employer: 968 },
    ];
    expected.forEach((hand, i) => {
      const row = rows[i];
      expect(row?.ral).toBeCloseTo(eur(hand.ral), 6);
      expect(row?.tfr).toBeCloseTo(eur(hand.tfr), 6);
      expect(row?.worker).toBeCloseTo(eur(hand.worker), 6);
      expect(row?.employer).toBeCloseTo(eur(hand.employer), 6);
    });
  });

  it("fills voluntary to the cap with TFR outside it, and caps the deduction", () => {
    // Voluntary = 5,300 + 2,650 - worker - employer; deductible = the whole 7,950.
    expect(rows.map((row) => row.voluntary / 100)).toEqual([
      expect.closeTo(6_750, 6),
      expect.closeTo(6_630, 6),
      expect.closeTo(6_498, 6),
    ]);
    for (const row of rows) expect(row.deductible).toBeCloseTo(eur(7_950), 6);
  });

  it("refunds the voluntary part inside the room at the marginal rate", () => {
    expect(rows.map((row) => row.refund / 100)).toEqual([
      expect.closeTo(6_750 * 0.35, 6),
      expect.closeTo(6_630 * 0.35, 6),
      expect.closeTo(6_498 * 0.35, 6),
    ]);
  });

  it("keeps the Y0 contribution fields full-year and puts YTD plus stub in the tax year", () => {
    // Stub = 6,750 x 6/12 = 3,375. YTD 2,000 gives a tax-year voluntary of 5,375; refund
    // 5,375 x 35% in 2027. The row itself stays full-year, so "row x f" is the stub.
    const [y0, y1] = pensionSchedule(plan, settings, "2026-06-30", eur(2_000), 2);
    expect(y0?.voluntary).toBeCloseTo(eur(6_750), 6);
    expect(y0?.tfr).toBeCloseTo(eur(2_764), 6);
    expect(y0?.voluntaryTaxYear).toBeCloseTo(eur(5_375), 6);
    expect(y0?.deductible).toBeCloseTo(eur(1_200 + 5_375), 6);
    expect(y0?.refund).toBeCloseTo(eur(5_375 * 0.35), 6);
    expect(y0?.refundYear).toBe(2027);
    // The next year does not use the YTD.
    expect(y1?.voluntary).toBeCloseTo(eur(6_630), 6);
    expect(y1?.voluntaryTaxYear).toBeCloseTo(eur(6_630), 6);
  });

  it("caps the Y0 refund and deduction when YTD plus the stub passes the room", () => {
    // 5,000 + 3,375 = 8,375 > room 6,750: refund on 6,750, deduction 7,950.
    const [y0] = pensionSchedule(plan, settings, "2026-06-30", eur(5_000), 1);
    expect(y0?.voluntary).toBeCloseTo(eur(6_750), 6);
    expect(y0?.voluntaryTaxYear).toBeCloseTo(eur(8_375), 6);
    expect(y0?.deductible).toBeCloseTo(eur(7_950), 6);
    expect(y0?.refund).toBeCloseTo(eur(6_750 * 0.35), 6);
  });

  it("uses a given voluntary amount, and refunds only up to the room", () => {
    const given = pensionPlanSchema.parse({ ...plan, voluntary: eur(1_000) });
    const rowsGiven = pensionSchedule(given, settings, "2026-12-31", 0, 2);
    // asOf in December: f = 0, so the Y0 tax year holds only the YTD (0). Year 2: voluntary 1,000.
    expect(rowsGiven[0]?.voluntary).toBe(eur(1_000));
    expect(rowsGiven[0]?.voluntaryTaxYear).toBe(0);
    expect(rowsGiven[1]?.voluntary).toBe(eur(1_000));
    expect(rowsGiven[1]?.deductible).toBeCloseTo(eur(1_320 + 1_000), 6);
    expect(rowsGiven[1]?.refund).toBeCloseTo(eur(1_000 * 0.35), 6);

    const large = pensionPlanSchema.parse({ ...plan, voluntary: eur(9_000) });
    const [, over] = pensionSchedule(large, settings, "2026-12-31", 0, 2);
    // Room 6,630: the refund stops there, the deduction stops at 7,950.
    expect(over?.refund).toBeCloseTo(eur(6_630 * 0.35), 6);
    expect(over?.deductible).toBeCloseTo(eur(7_950), 6);
  });

  it("gives no voluntary room when worker and employer already pass the cap", () => {
    const rich = pensionPlanSchema.parse({ ...plan, workerPct: 0.1, employerPct: 0.1 });
    const [y0] = pensionSchedule(rich, settings, "2026-12-31", 0, 1);
    expect(y0?.voluntary).toBe(0);
    expect(y0?.deductible).toBeCloseTo(eur(7_950), 6);
    expect(y0?.refund).toBe(0);
  });

  it("returns no rows for a plan without RAL", () => {
    const partial = pensionPlanSchema.parse({ goalId: "g", firstYear: 2020 });
    expect(pensionSchedule(partial, settings, "2026-06-30", 0)).toEqual([]);
  });

  it("runs 40 years by default", () => {
    expect(pensionSchedule(plan, settings, "2026-06-30", 0)).toHaveLength(40);
  });
});

describe("pensionFlowsByProduct (AC-46)", () => {
  // Work (TFR + worker + employer): A 60%, B 40%. Voluntary: A 20%, B 80%.
  // Work per year: 3,964 / 4,360.4 / 4,796.44. Voluntary to cap: 6,750 / 6,630 / 6,498.
  const flowPlan = pensionPlanSchema.parse({
    ...plan,
    flows: [
      { productId: "a", flow: "Work", pct: 0.6 },
      { productId: "b", flow: "Work", pct: 0.4 },
      { productId: "a", flow: "Voluntary", pct: 0.2 },
      { productId: "b", flow: "Voluntary", pct: 0.8 },
    ],
  });
  // The YTD (1,000) does not touch the split: Y0 splits the full-year amounts.
  const schedule = pensionSchedule(flowPlan, settings, "2026-06-30", eur(1_000), 3);
  const byYear = pensionFlowsByProduct(schedule, flowPlan.flows);

  const amount = (year: number, productId: string) =>
    byYear.find((row) => row.year === year)?.products.find((p) => p.productId === productId);

  it("splits each year's flows by that year's amounts", () => {
    // A = 0.6 x work + 0.2 x voluntary; B = 0.4 x work + 0.8 x voluntary.
    const hand = [
      { year: 2026, a: [0.6 * 3_964, 0.2 * 6_750], b: [0.4 * 3_964, 0.8 * 6_750] },
      { year: 2027, a: [0.6 * 4_360.4, 0.2 * 6_630], b: [0.4 * 4_360.4, 0.8 * 6_630] },
      { year: 2028, a: [0.6 * 4_796.44, 0.2 * 6_498], b: [0.4 * 4_796.44, 0.8 * 6_498] },
    ];
    for (const { year, a, b } of hand) {
      expect(amount(year, "a")?.work).toBeCloseTo(eur(a[0] ?? 0), 6);
      expect(amount(year, "a")?.voluntary).toBeCloseTo(eur(a[1] ?? 0), 6);
      expect(amount(year, "a")?.total).toBeCloseTo(eur((a[0] ?? 0) + (a[1] ?? 0)), 6);
      expect(amount(year, "b")?.work).toBeCloseTo(eur(b[0] ?? 0), 6);
      expect(amount(year, "b")?.voluntary).toBeCloseTo(eur(b[1] ?? 0), 6);
      expect(amount(year, "b")?.total).toBeCloseTo(eur((b[0] ?? 0) + (b[1] ?? 0)), 6);
    }
    expect(amount(2027, "a")?.total).toBeCloseTo(eur(3_942.24), 6);
    expect(amount(2028, "b")?.total).toBeCloseTo(eur(7_116.976), 6);
  });

  it("does not freeze the year-1 mix: the share of product A moves as voluntary shrinks", () => {
    const share = (year: number) => {
      const a = amount(year, "a")?.total ?? 0;
      const b = amount(year, "b")?.total ?? 0;
      return a / (a + b);
    };
    // Year 1 weights would give 3,728.4 / 10,714 = 34.80% in every year.
    expect(share(2026)).toBeCloseTo(3_728.4 / 10_714, 9);
    expect(share(2027)).toBeCloseTo(3_942.24 / 10_990.4, 9);
    expect(share(2028)).toBeCloseTo(4_177.464 / 11_294.44, 9);
    expect(share(2027)).toBeGreaterThan(share(2026) + 0.005);
  });

  it("sums a product's repeated entries for one flow and drops nothing else", () => {
    const rows = pensionFlowsByProduct(schedule.slice(0, 1), [
      { productId: "a", flow: "Work", pct: 0.3 },
      { productId: "a", flow: "Work", pct: 0.2 },
    ]);
    expect(rows[0]?.products).toHaveLength(1);
    expect(rows[0]?.products[0]?.work).toBeCloseTo(eur(0.5 * 3_964), 6);
    expect(rows[0]?.products[0]?.voluntary).toBe(0);
  });
});
