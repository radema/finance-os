// Zod schemas shared by the server (request validation, stored documents) and the web (types).
// Rates and weights are fractions (0.26 is 26%). Money is integer cents. Months are `YYYY-MM`.
import { z } from "zod";
import { ASSET_CLASSES } from "./assetClasses.ts";
import { toScaled } from "./units.ts";

const fraction = z.number().min(0).max(1);
const cents = z.number().int().min(0);
const text = z.string().trim();
const name = text.min(1);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "use YYYY-MM");

export const REGIMES = ["etf", "direct", "govt", "cash", "pension"] as const;
export const PRICE_SOURCES = ["provider", "csv", "manual"] as const;
/** BTP and pension funds have no price provider: their price is manual or CSV. */
export const canUseProvider = (regime: (typeof REGIMES)[number]): boolean =>
  regime !== "govt" && regime !== "pension";

export const PRIORITIES = ["Need", "Want", "Wish"] as const;

// --- Product ---------------------------------------------------------------------------------

/** A product as the user enters it. `brokerUnits` belong to the Prices screen (S2). */
export const productInputSchema = z.object({
  name,
  isin: text.default(""),
  assetClass: z.enum(ASSET_CLASSES),
  regime: z.enum(REGIMES),
  whiteListShare: fraction.default(0),
  // (1 + expReturn) must stay positive: the engine takes its logarithm.
  expReturn: z.number().gt(-1).max(1),
  volatility: z.number().min(0).max(2),
  ter: fraction,
  maturity: monthSchema.nullable().default(null),
  couponRate: fraction.default(0),
  zeroCommission: z.boolean().default(false),
  priceSource: z.enum(PRICE_SOURCES).default("manual"),
  ticker: text.default(""),
});
export type ProductInput = z.infer<typeof productInputSchema>;
export type Product = ProductInput & { id: string };

// --- Goal and plan history -------------------------------------------------------------------

export const goalInputSchema = z.object({
  name,
  priority: z.enum(PRIORITIES),
  /** Target in today's euros, in cents. */
  targetCents: cents,
  targetYear: z.number().int().min(2000).max(2200),
  contributionGrowth: fraction,
  minProb: fraction.nullable().default(null),
  countsTowardFi: z.boolean().default(false),
});
export type GoalInput = z.infer<typeof goalInputSchema>;

/** One version of a goal's monthly plan, in force from `fromMonth`. */
export const planVersionSchema = z.object({ fromMonth: monthSchema, monthlyCents: cents });
export type PlanVersionRecord = z.infer<typeof planVersionSchema>;
export type Goal = GoalInput & { id: string; plan: PlanVersionRecord[] };

// --- Allocation ------------------------------------------------------------------------------

export const allocationWeightSchema = z.object({
  goalId: z.string().min(1),
  productId: z.string().min(1),
  weight: z.number().min(0).max(1e9),
});

/** A weight and its share of the goal's total (the weights rescaled to 1). */
export type AllocationRow = z.infer<typeof allocationWeightSchema> & { share: number };

// --- Transaction -----------------------------------------------------------------------------

export const TRANSACTION_TYPES = [
  "opening",
  "buy",
  "sell",
  "pensionContribution",
  "coupon",
] as const;

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "not a real date");

/**
 * A transaction as the user enters it: an amount in cents (positive) and the quoted price. The
 * server derives the signed quantity. A coupon has no price; its amount is the net cash received.
 */
export const transactionInputSchema = z.object({
  date: isoDate,
  goalId: z.string().min(1),
  productId: z.string().min(1),
  type: z.enum(TRANSACTION_TYPES),
  amountCents: cents,
  /** Above 0 for every type but a coupon; the server checks that. */
  price: z.number().min(0).default(0),
  /** The actual commission in cents. Null or absent means none is recorded. */
  commissionCents: cents.nullable().default(null),
  note: text.default(""),
});
export type TransactionInput = z.infer<typeof transactionInputSchema>;

/** A transaction as the API returns it: `qty` is signed, `price` is the quoted price. */
export type Transaction = TransactionInput & { id: string; qty: number };

// --- Opening position ------------------------------------------------------------------------

const positiveNumber = z.number().positive().max(1e9);

const openingRowSchema = z
  .object({
    productId: z.string().min(1),
    totalUnits: positiveNumber,
    /** The account PMC, quoted like a price (a BTP per 100). */
    pmc: positiveNumber,
    parts: z
      .array(z.object({ goalId: z.string().min(1), units: positiveNumber }))
      .min(1, "give at least one bucket"),
  })
  .refine(
    ({ totalUnits, parts }) =>
      parts.reduce((sum, part) => sum + toScaled(part.units), 0) === toScaled(totalUnits),
    { message: "the parts must add up to the total units", path: ["parts"] },
  )
  .refine(({ parts }) => new Set(parts.map((part) => part.goalId)).size === parts.length, {
    message: "a bucket appears once per product",
    path: ["parts"],
  });

/** The Current portfolio form: one asOf date, and per product the total, the PMC and the split. */
export const openingPositionInputSchema = z.object({
  asOf: isoDate,
  positions: z
    .array(openingRowSchema)
    .min(1, "add at least one product")
    .refine((rows) => new Set(rows.map((row) => row.productId)).size === rows.length, {
      message: "a product appears once",
    }),
});
export type OpeningPositionInput = z.infer<typeof openingPositionInputSchema>;

/** The stored OpeningPosition document: the date of the account's opening position. */
export const openingDateSchema = z.object({ asOf: isoDate });

// --- Assumption documents --------------------------------------------------------------------

export const settingsSchema = z.object({
  inflation: fraction.default(0.02),
  taxStd: fraction.default(0.26),
  taxGovt: fraction.default(0.125),
  bollo: fraction.default(0.002),
  pensionTax: fraction.default(0.2),
  requiredProb: z
    .object({
      need: fraction.default(0.9),
      want: fraction.default(0.75),
      wish: fraction.default(0.5),
    })
    .prefault({}),
  mcPaths: z.number().int().min(1).max(100_000).default(1000),
  seed: z.number().int().default(42),
  trackingStart: monthSchema.default("2026-01"),
  zainetto: z
    .object({
      amountCents: cents.default(0),
      /** The year the credit expires. */
      expiry: z.number().int().min(2000).max(2200).default(2029),
      goalId: z.string().nullable().default(null),
    })
    .prefault({}),
  pensionDeductionCapCents: cents.default(530_000),
  thresholds: z
    .object({
      r1Months: z.number().int().min(1).default(3),
      r3Months: z.number().int().min(1).default(36),
      r7Multiple: z.number().positive().default(1.25),
      statusBandPoints: z.number().min(0).max(100).default(15),
      dailyPriceAgeDays: z.number().int().min(1).default(7),
    })
    .prefault({}),
});
export type Settings = z.infer<typeof settingsSchema>;

export const commissionSchema = z
  .object({
    plan: name.default("Fineco Trading"),
    feeModel: z.enum(["percent", "flat"]).default("percent"),
    rate: fraction.default(0.0019),
    minCents: cents.default(295),
    maxCents: cents.default(1900),
    flatFeeCents: cents.default(0),
    minTicketCents: cents.default(0),
  })
  .refine((commission) => commission.maxCents >= commission.minCents, {
    message: "the maximum fee cannot be below the minimum fee",
    path: ["maxCents"],
  });
export type Commission = z.infer<typeof commissionSchema>;

// The mock's sample correlations, in the order of ASSET_CLASSES.
export const DEFAULT_CORRELATIONS: number[][] = [
  [1, 0, 0.3, 0.85, 0, 0.1],
  [0, 1, 0.6, 0.4, 0, 0.2],
  [0.3, 0.6, 1, 0.55, 0, 0.1],
  [0.85, 0.4, 0.55, 1, 0, 0.15],
  [0, 0, 0, 0, 1, 0],
  [0.1, 0.2, 0.1, 0.15, 0, 1],
];

const SIZE = ASSET_CLASSES.length;

/** The stored matrix: 6x6, values in [-1, 1], 1 on the diagonal, symmetric. */
export const correlationMatrixSchema = z
  .array(z.array(z.number().min(-1).max(1)).length(SIZE))
  .length(SIZE)
  .refine((matrix) => matrix.every((row, i) => row[i] === 1), {
    message: "the diagonal must be 1",
  })
  .refine((matrix) => matrix.every((row, i) => row.every((value, j) => value === matrix[j]?.[i])), {
    message: "the matrix must be symmetric",
  });

export const correlationsSchema = z.object({
  matrix: correlationMatrixSchema.default(DEFAULT_CORRELATIONS),
});

/** What the server returns for correlations: the stored matrix, and the one the engine will use. */
export interface CorrelationsView {
  matrix: number[][];
  effective: number[][];
  /** True when the stored matrix is not positive definite and `effective` is a shrunk copy. */
  shrunk: boolean;
}
