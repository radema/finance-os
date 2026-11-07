import { fromCents } from "../engine/units.ts";

// `useGrouping: "always"`: it-IT skips the thousands dot on 4-digit numbers by default.
// `signDisplay: "negative"`: a value that rounds to zero prints without a minus sign.
const base = { useGrouping: "always", signDisplay: "negative" } as const;
const euro = new Intl.NumberFormat("it-IT", { ...base, style: "currency", currency: "EUR" });
const wholeEuro = new Intl.NumberFormat("it-IT", {
  ...base,
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat("it-IT", { ...base, maximumFractionDigits: 2 });
const signed = { ...base, signDisplay: "exceptZero" } as const;
const signedEuro = new Intl.NumberFormat("it-IT", {
  ...signed,
  style: "currency",
  currency: "EUR",
});
const signedPoints = new Intl.NumberFormat("it-IT", { ...signed, maximumFractionDigits: 2 });
const priceRule = { ...base, minimumFractionDigits: 2, maximumFractionDigits: 4 } as const;
const price = new Intl.NumberFormat("it-IT", priceRule);
const unitPrice = new Intl.NumberFormat("it-IT", {
  ...priceRule,
  style: "currency",
  currency: "EUR",
});
const quantity = {
  4: new Intl.NumberFormat("it-IT", { ...base, maximumFractionDigits: 4 }),
  6: new Intl.NumberFormat("it-IT", { ...base, maximumFractionDigits: 6 }),
};

/** Integer cents as a euro amount for the view, in it-IT format. */
export const formatEuro = (cents: number): string => euro.format(fromCents(cents));

/** Euros as a float, for the computed values of the Goals screens, in it-IT format. */
export const formatAmount = (euros: number): string => euro.format(euros);

/** A change in euros with its sign: "+39,30 €", "-961,74 €"; a change that rounds to zero has none. */
export const formatSignedAmount = (euros: number): string => signedEuro.format(euros);

/** A change of a probability in percentage points, with its sign: 0.05 is "+5 pts". */
export const formatSignedPoints = (fraction: number): string =>
  `${signedPoints.format(fraction * 100)}\u00a0pts`;

/** Euros without cents, for plan tables. */
export const formatWholeEuro = (euros: number): string => wholeEuro.format(euros);

/** A price as a plain number: 2 to 4 decimals, because a BTP unit is a euro cent range. */
export const formatPrice = (value: number): string => price.format(value);

/** The price or the average cost of one unit, in euros: the price rule with the euro sign. */
export const formatUnitPrice = (euros: number): string => unitPrice.format(euros);

/** A quantity of units as a plain number, in it-IT format: up to 4 decimals, or 6 for the Current portfolio. */
export const formatQuantity = (value: number, maxDecimals: 4 | 6 = 4): string =>
  quantity[maxDecimals].format(value);

/** A fraction as a percentage for the view: 0.065 is "6,5%". */
export const formatPercent = (fraction: number): string => `${percent.format(fraction * 100)}%`;

/** The current month, `YYYY-MM`, in local time. */
export const currentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
