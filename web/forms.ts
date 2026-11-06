import { fromCents, toCents } from "../engine/units.ts";

// Form fields hold text. These turn it into the numbers the API takes. Empty or bad text becomes
// NaN, which reaches the server as null and is refused there with the name of the field.

// A comma is the decimal mark; a dot before it groups thousands (`1.234,5`).
const WITH_COMMA = /^[+-]?(\d+|\d{1,3}(\.\d{3})+)?,\d+$/;
// Without a comma, a single dot is the decimal mark (`1.234` is 1.234).
const WITH_DOT = /^[+-]?(\d+|\d*\.\d+)$/;

/** Reads text with a decimal comma or a decimal dot. Anything else, and empty text, is NaN. */
export function num(text: string): number {
  const typed = text.trim();
  if (WITH_COMMA.test(typed)) return Number(typed.replaceAll(".", "").replace(",", "."));
  return WITH_DOT.test(typed) ? Number(typed) : Number.NaN;
}

/** The text of a stored number as the app shows numbers: a decimal comma. Text with a comma stays. */
export const showDecimal = (text: string): string =>
  text.includes(",") ? text : text.replaceAll(".", ",");
export const percentToFraction = (text: string): number => +(num(text) / 100).toPrecision(12);
export const eurosToCents = (text: string): number => toCents(num(text));

export const fractionToPercent = (fraction: number): string =>
  String(+(fraction * 100).toPrecision(12));
export const centsToEuros = (cents: number): string => String(fromCents(cents));
