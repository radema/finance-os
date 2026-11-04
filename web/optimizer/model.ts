import type { MixView } from "../../engine/optimizerView.ts";
import { formatPercent } from "../money.ts";

/** The most products a mix can hold. */
export const MAX_PRODUCTS = 6;

type ListedProduct = { id: string; name: string; regime: string };

/** The products the goal can use: pension funds for the pension goal, all the others for any other goal. */
export const eligibleProducts = <T extends ListedProduct>(
  products: readonly T[],
  isPension: boolean,
): T[] => products.filter((product) => (product.regime === "pension") === isPension);

/** The products the goal's allocation holds; with none, the first eligible products. At most six. */
export function defaultUniverse(
  goalId: string,
  allocation: readonly { goalId: string; productId: string }[],
  eligible: readonly ListedProduct[],
): string[] {
  const held = new Set(
    allocation.filter((row) => row.goalId === goalId).map((row) => row.productId),
  );
  const own = eligible.filter((product) => held.has(product.id));
  return (own.length > 0 ? own : eligible).slice(0, MAX_PRODUCTS).map((product) => product.id);
}

/** Bad, typical and good case of the current and the suggested mix, in euros. */
export const outcomeRows = (current: MixView, suggested: MixView) => [
  { label: "Bad case", current: current.p10, suggested: suggested.p10 },
  { label: "Typical case", current: current.median, suggested: suggested.median },
  { label: "Good case", current: current.p90, suggested: suggested.p90 },
];

/** Every product of either mix with its weight in each, the biggest weight first. */
export function weightRows(current: MixView, suggested: MixView) {
  const of = (mix: MixView, productId: string) =>
    mix.weights.find((row) => row.productId === productId)?.weight ?? 0;
  const ids = new Set([...current.weights, ...suggested.weights].map((row) => row.productId));
  return [...ids]
    .map((productId) => ({
      productId,
      current: of(current, productId),
      suggested: of(suggested, productId),
    }))
    .sort((a, b) => Math.max(b.current, b.suggested) - Math.max(a.current, a.suggested));
}

/** A mix in words: "World ETF 65%, Govt 2029 35%". */
export const mixText = (mix: MixView, names: ReadonlyMap<string, string>): string =>
  mix.weights
    .map((row) => `${names.get(row.productId) ?? row.productId} ${formatPercent(row.weight)}`)
    .join(", ");
