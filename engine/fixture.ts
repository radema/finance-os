// The synthetic fixture (fixtures/sample.json): the engine's regression input and the app's sample
// data. Ledger quantities, prices and commissions are in euros as floats; the loader converts them
// to integer storage units. Goal targets, plan amounts and the zainetto amount are already in
// integer cents (`targetCents`, `monthlyCents`, `amountCents`), like the cash flow document.
import { z } from "zod";
import {
  allocationWeightSchema,
  cashFlowSchema,
  goalInputSchema,
  monthSchema,
  PENSION_FLOWS,
  pensionPlanSchema,
  planVersionSchema,
  productInputSchema,
  settingsSchema,
} from "./schemas.ts";

const id = z.string().min(1);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

/** One month-end price. Bonds are quoted per 100, pension funds by unit value. */
export const samplePriceSchema = z.object({
  productId: id,
  month: monthSchema,
  price: z.number().positive(),
  /** The date of the close. */
  priceDate: isoDate,
});

/** One ledger row. `price` is the quoted price; `commission` is in euros. */
export const sampleTransactionSchema = z.object({
  date: isoDate,
  goalId: id,
  productId: id,
  type: z.enum(["opening", "buy", "sell", "pensionContribution"]),
  /** `pensionContribution` only. */
  flow: z.enum(PENSION_FLOWS).optional(),
  /** Signed: a sell is negative. */
  qty: z.number(),
  price: z.number().positive(),
  commission: z.number().min(0).optional(),
});

export const sampleDataSchema = z.object({
  /** The pinned "today": `YYYY-MM-DD`. */
  asOf: isoDate,
  settings: settingsSchema,
  products: z.array(productInputSchema.extend({ id })),
  prices: z.array(samplePriceSchema),
  goals: z.array(goalInputSchema.extend({ id, plan: z.array(planVersionSchema) })),
  allocation: z.array(allocationWeightSchema),
  ledger: z.array(sampleTransactionSchema),
  pensionPlan: pensionPlanSchema,
  cashFlow: cashFlowSchema,
});
export type SampleData = z.infer<typeof sampleDataSchema>;
