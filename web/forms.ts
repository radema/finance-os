import { fromCents, toCents } from "../engine/units.ts";

// Form fields hold text. These turn it into the numbers the API takes. Empty or bad text becomes
// NaN, which reaches the server as null and is refused there with the name of the field.
export const num = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));
export const percentToFraction = (text: string): number => +(num(text) / 100).toPrecision(12);
export const eurosToCents = (text: string): number => toCents(num(text));

export const fractionToPercent = (fraction: number): string =>
  String(+(fraction * 100).toPrecision(12));
export const centsToEuros = (cents: number): string => String(fromCents(cents));
