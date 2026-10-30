import { fromCents } from "../engine/units.ts";

const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const percent = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

/** Integer cents as a euro amount for the view, in it-IT format. */
export const formatEuro = (cents: number): string => euro.format(fromCents(cents));

/** A fraction as a percentage for the view: 0.065 is "6,5%". */
export const formatPercent = (fraction: number): string => `${percent.format(fraction * 100)}%`;

/** The current month, `YYYY-MM`, in local time. */
export const currentMonth = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
