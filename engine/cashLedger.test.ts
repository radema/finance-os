import { describe, expect, it } from "vitest";
import type { CashMovement, CashTrade } from "./cashLedger.ts";
import { CashLedgerError, replayCash } from "./cashLedger.ts";

const trade = (overrides: Partial<CashTrade> = {}): CashTrade => ({
  id: "buy",
  date: "2026-01-02",
  goalId: "g",
  productId: "p",
  type: "buy",
  qty: 1,
  price: 10,
  amountCents: 1000,
  commissionCents: 10,
  ...overrides,
});
const movement = (overrides: Partial<CashMovement> = {}): CashMovement => ({
  id: "cash",
  date: "2026-01-01",
  goalId: "g",
  type: "contribution",
  amountCents: 1010,
  toGoalId: null,
  note: "",
  sourceId: null,
  importBatchId: null,
  ...overrides,
});
describe("Bucket Cash replay", () => {
  it("reconstructs legacy funding after proceeds without mutating transactions", () => {
    const rows = [
      trade({
        id: "sale",
        type: "sell",
        amountCents: 400,
        commissionCents: null,
        date: "2026-01-02",
        legacy: true,
      }),
      trade({ legacy: true }),
    ];
    const before = structuredClone(rows);
    const result = replayCash(rows, []);
    expect(rows).toEqual(before);
    expect(result.balances.get("g")).toBe(0);
    expect(result.inferredFunding[0]?.amountCents).toBe(610);
    expect(result.actualContributions.size).toBe(0);
  });
  it("rejects a modern shortfall including commissions with exact cents", () => {
    expect(() => replayCash([trade()], [movement({ amountCents: 1000 })])).toThrow(CashLedgerError);
    try {
      replayCash([trade()], [movement({ amountCents: 1000 })]);
    } catch (error) {
      expect(error).toMatchObject({ shortfallCents: 10, date: "2026-01-02" });
    }
  });
  it("moves cash atomically between buckets without external flows", () => {
    const state = replayCash(
      [],
      [
        movement({ type: "opening" }),
        movement({ id: "transfer", type: "transfer", amountCents: 400, toGoalId: "h" }),
      ],
    );
    expect([...state.balances]).toEqual([
      ["g", 610],
      ["h", 400],
    ]);
    expect(state.externalFlows).toEqual([]);
  });
  it("checks the entire history, not only the final balance", () => {
    expect(() => replayCash([trade()], [movement({ date: "2026-01-03" })])).toThrow(
      CashLedgerError,
    );
  });
  it("does not route pension money through Bucket Cash", () => {
    expect(replayCash([trade({ regime: "pension" })], []).balances.size).toBe(0);
  });
});
