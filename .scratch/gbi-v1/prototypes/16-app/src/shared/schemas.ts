/* Request schemas, shared by the server (validation at the edge) and the UI (types). */
import { z } from 'zod';

const month = z.string().regex(/^\d{4}-\d{2}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const ClassSchema = z.enum(['Equity', 'Govt bonds', 'Corp bonds', 'Multi-asset', 'Cash', 'Gold/Commodities']);
export const RegimeSchema = z.enum(['etf', 'direct', 'govt', 'cash', 'pension']);

export const ProductInput = z.object({
  id: z.string().optional(), name: z.string().min(1), isin: z.string().default(''), cls: ClassSchema, regime: RegimeSchema,
  wl: z.number().min(0).max(1).default(0), mu: z.number(), vol: z.number().min(0), ter: z.number().min(0).default(0), zero: z.boolean().default(false),
  maturity: z.string().default(''), ticker: z.string().default(''), source: z.enum(['yahoo', 'manual', 'csv']).default('manual'), couponRate: z.number().min(0).default(0)
});
export const GoalInput = z.object({
  id: z.string().optional(), name: z.string().min(1), priority: z.enum(['Need', 'Want', 'Wish']), target: z.number().positive(), year: z.number().int(),
  cgrowth: z.number().default(0.02), minProb: z.number().min(0).max(1).nullable().default(null), fire: z.boolean().default(false), isPension: z.boolean().default(false),
  /** Ticket 10: editing the monthly contribution asks "from which month". */
  monthly: z.number().min(0).optional(), monthlyFrom: month.optional()
});
export const WeightsInput = z.object({ goalId: z.string(), weights: z.array(z.object({ productId: z.string(), weight: z.number().min(0) })) });
export const TxInput = z.object({
  date: day, goalId: z.string(), productId: z.string(), type: z.enum(['opening', 'buy', 'sell', 'pensionContribution', 'coupon']),
  qty: z.number(), price: z.number().min(0), commission: z.number().min(0).nullable().default(null), amount: z.number().nullable().default(null), note: z.string().default('')
});
export const PriceInput = z.object({ productId: z.string(), month, price: z.number().positive(), source: z.enum(['yahoo', 'manual', 'csv']).default('manual') });
export const PricesInput = z.object({ prices: z.array(PriceInput) });

/** Ticket 08: "Current portfolio" form. One as-of date; per product total units and the fiscal PMC; units split across goals. */
export const OpeningInput = z.object({
  asOf: day,
  items: z.array(z.object({ productId: z.string(), pmc: z.number().min(0), parts: z.array(z.object({ goalId: z.string(), units: z.number().positive() })).min(1) }))
});
export const SettingsPatch = z.object({
  inflation: z.number(), taxStd: z.number(), taxGovt: z.number(), bollo: z.number(), pensionTax: z.number(), paths: z.number().int().min(50).max(20000), seed: z.number().int(),
  probNeed: z.number(), probWant: z.number(), probWish: z.number(), trackingStart: month, behindMonths: z.number().int().min(0), staleDays: z.number().int().min(0),
  commission: z.object({ rate: z.number(), min: z.number(), max: z.number() }),
  zainetto: z.object({ amount: z.number(), expiry: z.number().int(), goalId: z.string() }),
  fire: z.object({ efFromGoal: z.string(), efMonths: z.number(), l2Mult: z.number(), l3Mult: z.number(), includePension: z.boolean() })
}).partial();
export const CashflowPatch = z.object({
  income: z.number(), incomeGrowth: z.number(), essential: z.number(), optional: z.number(), expenseGrowth: z.number(),
  events: z.array(z.object({ year: z.number().int(), label: z.string(), amount: z.number() }))
}).partial();

/** Import: the client sends the parsed rows back with one decision per row. */
export const ImportDecision = z.object({
  n: z.number().int(), mode: z.enum(['auto', 'one', 'weights', 'units', 'skip']),
  goalId: z.string().optional(), parts: z.array(z.object({ goalId: z.string(), units: z.number().positive() })).optional()
});
export const ImportRowSchema = z.object({
  n: z.number().int(), date: day, isin: z.string(), name: z.string(), kind: z.enum(['trade', 'coupon', 'other']), side: z.enum(['A', 'V', '']),
  qty: z.number(), price: z.number(), currency: z.string(), fx: z.number(), amount: z.number().nullable(), commission: z.number(), description: z.string()
});
export const ImportCommit = z.object({ fileName: z.string(), rows: z.array(ImportRowSchema), decisions: z.array(ImportDecision) });
export const OptimizerInput = z.object({
  goalId: z.string(), mode: z.enum(['new', 'rebalance']).default('new'), criterion: z.enum(['auto', 'p10', 'median', 'prob', 'cheapest']).default('auto'),
  maxW: z.number().min(0.1).max(1).default(1), universe: z.array(z.string()).default([])
});
export const ApplyWeights = z.object({ goalId: z.string(), weights: z.array(z.number()), universe: z.array(z.string()) });

export type ProductIn = z.infer<typeof ProductInput>;
export type GoalIn = z.infer<typeof GoalInput>;
export type TxIn = z.infer<typeof TxInput>;
export type OpeningIn = z.infer<typeof OpeningInput>;
export type ImportRow = z.infer<typeof ImportRowSchema>;
export type ImportDecisionIn = z.infer<typeof ImportDecision>;
export type OptimizerIn = z.infer<typeof OptimizerInput>;
