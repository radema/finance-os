import { describe, expect, it } from "vitest";
import type { GoalStatus } from "./goalStatus.ts";
import type { LedgerRow } from "./holdings.ts";
import type { PlanVsActualGoal } from "./planVsActual.ts";
import type { Alert, RuleId, RuleInput, RuleTrade } from "./rules.ts";
import { evaluateRules } from "./rules.ts";
import { commissionSchema, settingsSchema } from "./schemas.ts";

// Money is in cents. Month `2026-10` is the valuation month of every case.
const eur = (euros: number) => euros * 100;

const GOAL = { id: "g1", name: "House", priority: "Want", targetYear: 2035 } as const;
const ETF = {
  id: "p1",
  name: "World ETF",
  assetClass: "Equity",
  maturity: null,
  brokerUnits: null,
  brokerUnitsDate: null,
} as const;
const BTP = { ...ETF, id: "p2", name: "BTP 2030", assetClass: "Govt bonds" } as const;

/** A buy of `units` of a product into a bucket. */
const buy = (units: number, goalId = "g1", productId = "p1", date = "2026-01-15"): LedgerRow => ({
  date,
  goalId,
  productId,
  type: "buy",
  qty: units,
  price: 100,
});

/** A plan-vs-actual history that ends at `gap` with `planned` per month. */
const behind = (gap: number, planned: number, goalId = "g1"): PlanVsActualGoal => ({
  goalId,
  months: [{ month: "2026-10", planned, actual: 0, cumPlanned: 0, cumActual: 0, gap }],
});

/** Nothing is wrong: no rule fires. */
const quiet = (): RuleInput => ({
  asOf: "2026-10-31",
  settings: settingsSchema.parse({}),
  commission: commissionSchema.parse({}),
  goals: [GOAL],
  planVsActual: [behind(0, eur(600))],
  pension: null,
  statuses: new Map<string, GoalStatus | null>([["g1", "on_track"]]),
  latestSnapshot: null,
  ledger: [buy(10)],
  products: [ETF, BTP],
  unitPrices: new Map([
    ["p1", 100],
    ["p2", 100],
  ]),
  priceAge: new Map([["p1", { old: false, reason: "fresh" }]]),
  trades: [],
  fetchProblems: [],
});

const run = (overrides: Partial<RuleInput>) => evaluateRules({ ...quiet(), ...overrides });
const only = (alerts: Alert[], ruleId: RuleId) => alerts.filter((alert) => alert.ruleId === ruleId);

describe("evaluateRules", () => {
  it("returns no alert when nothing is wrong", () => {
    expect(run({})).toEqual([]);
  });

  describe("R1 Behind plan", () => {
    // Plan 600 a month, N = 3: 1,800. The default Fineco plan has a minimum efficient ticket of
    // 295 / 0.0019 = 1,552.63. The plan in force in the valuation month sets the N-month limit.
    it("fires at a gap of -1,801 (AC-69)", () => {
      const [alert] = only(run({ planVsActual: [behind(eur(-1801), eur(600))] }), "R1");
      expect(alert).toMatchObject({
        ruleId: "R1",
        severity: "Medium",
        scope: { kind: "goal", id: "g1" },
        key: "g1|2026-10",
      });
      expect(alert?.condition).toContain("1801,00");
    });

    it("is silent at a gap of -1,799 (AC-69)", () => {
      expect(only(run({ planVsActual: [behind(eur(-1799), eur(600))] }), "R1")).toEqual([]);
    });

    it("is silent at exactly N months of plan: the inequality is strict", () => {
      expect(only(run({ planVsActual: [behind(eur(-1800), eur(600))] }), "R1")).toEqual([]);
    });

    it("is silent when the gap is above N months of plan but below the minimum ticket (AC-69)", () => {
      // Plan 100: 3 months = 300. A gap of -1,000 is far past that, but under 1,552.63.
      expect(only(run({ planVsActual: [behind(eur(-1000), eur(100))] }), "R1")).toEqual([]);
    });

    it("is silent for the pension goal", () => {
      const alerts = run({
        planVsActual: [behind(eur(-5000), eur(600))],
        pension: { goalId: "g1", deduction: null },
      });
      expect(only(alerts, "R1")).toEqual([]);
    });
  });

  describe("R2 Deduction room", () => {
    const deduction = {
      workerCents: eur(800),
      employerCents: eur(0),
      extraCents: eur(2650),
      voluntaryYtdCents: eur(7000),
    };

    it("fires when cap + extra exceed worker + employer + voluntary YTD", () => {
      // 5,300 + 2,650 - (800 + 0 + 7,000) = 150
      const [alert] = only(run({ pension: { goalId: "g9", deduction } }), "R2");
      expect(alert).toMatchObject({
        ruleId: "R2",
        severity: "Info",
        scope: { kind: "none", id: "" },
        key: "2026",
      });
      expect(alert?.condition).toContain("150");
    });

    it("is silent when the room is used up", () => {
      const used = { ...deduction, voluntaryYtdCents: eur(7150) };
      expect(only(run({ pension: { goalId: "g9", deduction: used } }), "R2")).toEqual([]);
    });

    it("is silent without a pension schedule", () => {
      expect(only(run({ pension: { goalId: "g9", deduction: null } }), "R2")).toEqual([]);
    });
  });

  describe("R3 Maturity ahead", () => {
    const held = { ledger: [buy(10, "g1", "p2")] };

    it("fires for a held product that matures within 36 months", () => {
      // 2026-10 to 2029-10 is exactly 36 months.
      const [alert] = only(run({ ...held, products: [{ ...BTP, maturity: "2029-10" }] }), "R3");
      expect(alert).toMatchObject({
        severity: "Medium",
        scope: { kind: "product", id: "p2" },
        key: "p2|2029-10",
      });
    });

    it("is silent beyond 36 months", () => {
      const products = [{ ...BTP, maturity: "2029-11" }];
      expect(only(run({ ...held, products }), "R3")).toEqual([]);
    });

    it("is silent for a product that is not held", () => {
      const products = [{ ...BTP, maturity: "2027-01" }];
      expect(only(run({ products }), "R3")).toEqual([]);
    });
  });

  describe("R4 Status worsened", () => {
    const snapshot = (status: GoalStatus | null) => ({
      month: "2026-09",
      statuses: new Map([["g1", status]]),
    });

    it("fires for On track to At risk", () => {
      const alerts = run({
        statuses: new Map([["g1", "at_risk"]]),
        latestSnapshot: snapshot("on_track"),
      });
      expect(only(alerts, "R4")[0]).toMatchObject({
        severity: "Medium",
        scope: { kind: "goal", id: "g1" },
        key: "g1|at_risk",
      });
    });

    it("is silent for an unchanged status", () => {
      const alerts = run({
        statuses: new Map([["g1", "at_risk"]]),
        latestSnapshot: snapshot("at_risk"),
      });
      expect(only(alerts, "R4")).toEqual([]);
    });

    it("is silent for a better status, and without a snapshot", () => {
      const better = run({
        statuses: new Map([["g1", "on_track"]]),
        latestSnapshot: snapshot("off_track"),
      });
      expect(only(better, "R4")).toEqual([]);
      expect(only(run({ statuses: new Map([["g1", "off_track"]]) }), "R4")).toEqual([]);
    });
  });

  describe("R5 Stale prices", () => {
    it("fires for held products with an old price, as one set", () => {
      const alerts = run({
        ledger: [buy(10), buy(5, "g1", "p2")],
        priceAge: new Map([
          ["p2", { old: true, reason: "no price" }],
          ["p1", { old: true, reason: "8 days old" }],
        ]),
      });
      const [alert] = only(alerts, "R5");
      expect(alert).toMatchObject({
        severity: "Medium",
        scope: { kind: "none", id: "" },
        key: "p1,p2",
      });
      expect(alert?.condition).toContain("World ETF");
    });

    it("is silent when the old price belongs to a product that is not held", () => {
      const priceAge = new Map([["p2", { old: true, reason: "no price" }]]);
      expect(only(run({ priceAge }), "R5")).toEqual([]);
    });
  });

  describe("R6 Need off track", () => {
    const need = { ...GOAL, priority: "Need" } as const;

    it("fires for a Need that is off track", () => {
      const alerts = run({ goals: [need], statuses: new Map([["g1", "off_track"]]) });
      expect(only(alerts, "R6")[0]).toMatchObject({
        severity: "High",
        scope: { kind: "goal", id: "g1" },
        key: "g1|2026-10",
      });
    });

    it("is silent for a Need at risk, and for a Want off track", () => {
      const atRisk = run({ goals: [need], statuses: new Map([["g1", "at_risk"]]) });
      const want = run({ statuses: new Map([["g1", "off_track"]]) });
      expect(only(atRisk, "R6")).toEqual([]);
      expect(only(want, "R6")).toEqual([]);
    });
  });

  describe("R7 Costly trades", () => {
    const trade = (id: string, amountCents: number, commissionCents: number | null, date: string) =>
      ({ id, date, productId: "p1", type: "buy", amountCents, commissionCents }) as RuleTrade;

    it("fires when the commission is above 1.25 times the plan rate", () => {
      // Rate 0.19%: a 2.95 fee on 500 is 0.59%. The latest costly trade names the key.
      const trades = [
        trade("t1", eur(500), 295, "2026-03-10"),
        trade("t2", eur(500), 295, "2026-09-10"),
      ];
      const [alert] = only(run({ trades }), "R7");
      expect(alert).toMatchObject({
        severity: "Info",
        scope: { kind: "none", id: "" },
        key: "t2",
      });
    });

    it("is silent when the commission is at or below 1.25 times the rate", () => {
      // 19 on 10,000 is exactly the rate.
      expect(only(run({ trades: [trade("t1", eur(10_000), 1900, "2026-09-10")] }), "R7")).toEqual(
        [],
      );
    });

    it("ignores trades with no commission and trades older than 12 months", () => {
      const trades = [
        trade("t1", eur(500), null, "2026-09-10"),
        trade("t2", eur(500), 295, "2025-10-31"),
      ];
      expect(only(run({ trades }), "R7")).toEqual([]);
    });

    describe("with a flat fee of 5 and a minimum ticket of 1,000", () => {
      const commission = commissionSchema.parse({
        feeModel: "flat",
        flatFeeCents: eur(5),
        minTicketCents: eur(1000),
      });

      it("fires below minTicket / 1.25 = 800", () => {
        const trades = [trade("t1", eur(799), eur(5), "2026-09-10")];
        expect(only(run({ commission, trades }), "R7")).toHaveLength(1);
      });

      it("is silent above 800", () => {
        const trades = [trade("t1", eur(801), eur(5), "2026-09-10")];
        expect(only(run({ commission, trades }), "R7")).toEqual([]);
      });
    });
  });

  describe("R8 Near goal, risky assets", () => {
    // asOf 2026-10-31: a goal due in 2026 is 0.17 years away, one due in 2027 is 1.17.
    it("fires for a goal due within a year that holds equity", () => {
      const [alert] = only(run({ goals: [{ ...GOAL, targetYear: 2026 }] }), "R8");
      expect(alert).toMatchObject({
        severity: "Medium",
        scope: { kind: "goal", id: "g1" },
        key: "g1",
      });
    });

    it("is silent when the goal is more than a year away", () => {
      expect(only(run({ goals: [{ ...GOAL, targetYear: 2027 }] }), "R8")).toEqual([]);
    });

    it("is silent when the near goal holds no equity", () => {
      const alerts = run({ goals: [{ ...GOAL, targetYear: 2026 }], ledger: [buy(10, "g1", "p2")] });
      expect(only(alerts, "R8")).toEqual([]);
    });
  });

  describe("R9 Units mismatch", () => {
    const entered = (units: number, date: string) => [
      { ...ETF, brokerUnits: units, brokerUnitsDate: date },
    ];

    it("fires when the broker units differ from the buckets' units", () => {
      const [alert] = only(run({ products: entered(9, "2026-10-31") }), "R9");
      expect(alert).toMatchObject({
        severity: "High",
        scope: { kind: "product", id: "p1" },
        key: "p1|10000000|9000000",
      });
    });

    it("is silent when they match, and when no broker units are entered", () => {
      expect(only(run({ products: entered(10, "2026-10-31") }), "R9")).toEqual([]);
      expect(only(run({}), "R9")).toEqual([]);
    });

    it("compares the buckets as they were on the broker date", () => {
      // 5 more units are bought after the broker date, which does not make a mismatch.
      const ledger = [buy(10), buy(5, "g1", "p1", "2026-10-20")];
      expect(only(run({ ledger, products: entered(10, "2026-10-10") }), "R9")).toEqual([]);
    });
  });

  describe("R10 Price fetch failed", () => {
    it("fires for the products with a fetch problem, as one set", () => {
      const fetchProblems = [
        { productId: "p2", reason: "non-eur" },
        { productId: "p1", reason: "provider-error" },
        { productId: "p1", reason: "move-above-25" },
      ] as const;
      const [alert] = only(run({ fetchProblems }), "R10");
      expect(alert).toMatchObject({
        severity: "Medium",
        scope: { kind: "none", id: "" },
        key: "p1,p2",
      });
    });

    it("is silent without a problem", () => {
      expect(only(run({ fetchProblems: [] }), "R10")).toEqual([]);
    });
  });

  it("gives every alert a rule id, a name, a condition and a key (AC-72)", () => {
    const alerts = run({
      planVsActual: [behind(eur(-1801), eur(600))],
      fetchProblems: [{ productId: "p1", reason: "provider-error" }],
      goals: [{ ...GOAL, targetYear: 2026 }],
    });
    expect(alerts.length).toBeGreaterThan(2);
    for (const alert of alerts) {
      expect(alert.ruleId).toMatch(/^R\d+$/);
      expect(alert.name).not.toBe("");
      expect(alert.condition).not.toBe("");
      expect(alert.key).not.toBe("");
    }
  });
});
