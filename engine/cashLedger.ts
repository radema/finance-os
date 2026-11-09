import type { TransactionInput } from "./schemas.ts";
export interface CashTrade {
  id: string;
  date: string;
  goalId: string;
  productId: string;
  type: TransactionInput["type"];
  qty: number;
  price: number;
  amountCents: number;
  commissionCents: number | null;
  legacy?: boolean;
  regime?: string;
}
export interface CashMovement {
  id: string;
  date: string;
  goalId: string;
  type: "opening" | "contribution" | "withdrawal" | "transfer" | "fee" | "tax" | "income";
  amountCents: number;
  toGoalId: string | null;
  note: string;
  sourceId: string | null;
  importBatchId: string | null;
}
export interface CashFlowEntry {
  id: string;
  date: string;
  goalId: string;
  amountCents: number;
  type: string;
}
export class CashLedgerError extends Error {
  goalId: string;
  date: string;
  shortfallCents: number;
  constructor(goalId: string, date: string, shortfallCents: number) {
    super(
      `Bucket ${goalId} needs ${shortfallCents} cents additional funding on ${date}. Confirm an external contribution or add Bucket Cash first.`,
    );
    this.goalId = goalId;
    this.date = date;
    this.shortfallCents = shortfallCents;
  }
}
/** Date order; credits, proceeds, transfers, purchases, debits. Source order breaks ties. */
export function replayCash(
  trades: readonly CashTrade[],
  movements: readonly CashMovement[],
  asOf = "9999-12-31",
) {
  const balances = new Map<string, number>();
  const inferredFunding: CashFlowEntry[] = [];
  const externalFlows: CashFlowEntry[] = [];
  const actualContributions = new Map<string, number>();
  const change = (goalId: string, amount: number, date: string) => {
    const next = (balances.get(goalId) ?? 0) + amount;
    if (next < 0) throw new CashLedgerError(goalId, date, -next);
    balances.set(goalId, next);
  };
  const entries = [
    ...movements.map((movement, sequence) => ({
      date: movement.date,
      priority: ["opening", "contribution", "income"].includes(movement.type)
        ? 0
        : movement.type === "transfer"
          ? 2
          : 4,
      sequence,
      movement,
      trade: undefined,
    })),
    ...trades.map((trade, sequence) => ({
      date: trade.date,
      priority: trade.type === "sell" || trade.type === "coupon" ? 1 : 3,
      sequence,
      trade,
      movement: undefined,
    })),
  ]
    .filter((entry) => entry.date <= asOf)
    .sort(
      (a, b) => a.date.localeCompare(b.date) || a.priority - b.priority || a.sequence - b.sequence,
    );
  for (const { trade, movement } of entries) {
    if (movement) {
      const { goalId, amountCents, date, type } = movement;
      change(
        goalId,
        ["opening", "contribution", "income"].includes(type) ? amountCents : -amountCents,
        date,
      );
      if (type === "transfer" && movement.toGoalId) change(movement.toGoalId, amountCents, date);
      if (type === "contribution" || type === "withdrawal")
        externalFlows.push({
          ...movement,
          amountCents: type === "withdrawal" ? -amountCents : amountCents,
        });
      if (type === "contribution")
        actualContributions.set(goalId, (actualContributions.get(goalId) ?? 0) + amountCents);
      continue;
    }
    if (
      !trade ||
      trade.regime === "pension" ||
      trade.type === "opening" ||
      trade.type === "pensionContribution"
    )
      continue;
    const { goalId, date, amountCents, commissionCents } = trade;
    const delta =
      trade.type === "buy"
        ? -amountCents - (commissionCents ?? 0)
        : amountCents - (commissionCents ?? 0);
    const shortfall = -((balances.get(goalId) ?? 0) + delta);
    if (trade.legacy && shortfall > 0) {
      const funding = {
        id: `legacy:${trade.id}`,
        date,
        goalId,
        amountCents: shortfall,
        type: "legacyFunding",
      };
      inferredFunding.push(funding);
      externalFlows.push(funding);
      change(goalId, shortfall, date);
    }
    change(goalId, delta, date);
  }
  return { balances, inferredFunding, externalFlows, actualContributions };
}
