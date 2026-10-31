export type { CashFlowGoal, CashFlowInput, CashFlowView, CashFlowYear } from "./cashFlow.ts";
export { projectCashFlow } from "./cashFlow.ts";
export { estimateCommission, isCostly, minEfficientTicket } from "./commission.ts";
export type {
  Holdings,
  LedgerRow,
  Regime,
  TransactionType,
} from "./holdings.ts";
export { holdingsAt, unitPrice } from "./holdings.ts";
export type { PensionYear, PensionYearFlows, ProductFlow } from "./pension.ts";
export { pensionFlowsByProduct, pensionSchedule } from "./pension.ts";
export type {
  GoalProjection,
  Position,
  ProductParams,
  ProductProjection,
  ProjectionInput,
  ProjectionSettings,
  Step,
  TimeGrid,
} from "./projection.ts";
export { normaliseWeights, projectGoal, timeGrid } from "./projection.ts";
export type { CashFlow, CashFlowEvent, PensionFlow, PensionPlan } from "./schemas.ts";
export { cashFlowSchema, pensionPlanSchema } from "./schemas.ts";
export { goalSlot } from "./slots.ts";
export type {
  Liquidation,
  LiquidationContext,
  LiquidationPosition,
  Zainetto,
} from "./tax.ts";
export { liquidate, pensionExitRate } from "./tax.ts";
