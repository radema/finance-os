import type { MixView } from "../../engine/optimizerView.ts";
import { formatPercent, formatSignedAmount, formatSignedPoints } from "../money.ts";

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

/** Bad, typical and good case of the current and the suggested mix, in euros, and the change (suggested minus current). */
export const outcomeRows = (current: MixView, suggested: MixView) =>
  [
    { label: "Bad case", current: current.p10, suggested: suggested.p10 },
    { label: "Typical case", current: current.median, suggested: suggested.median },
    { label: "Good case", current: current.p90, suggested: suggested.p90 },
  ].map((row) => ({ ...row, change: row.suggested - row.current }));

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
export const mixText = (weights: MixView["weights"], names: ReadonlyMap<string, string>): string =>
  weights
    .map((row) => `${names.get(row.productId) ?? row.productId} ${formatPercent(row.weight)}`)
    .join(", ");

const SHORT_NAME_LENGTH = 16;
const SHORT_MIX_SHOWN = 2;

/** The words every product name starts with ("Sample"), when each name keeps at least one word after them. */
function commonPrefix(names: ReadonlyMap<string, string>): number {
  const words = [...names.values()].map((name) => name.split(" "));
  const shortest = Math.min(...words.map((row) => row.length)) - 1;
  let count = 0;
  while (count < shortest && words.every((row) => row[count] === words[0][count])) count++;
  return count;
}

/** A mix with short names for a table cell: "Direct Share 80%, Govt Bond 2029 10% +1". The full names go in `mixText`. */
export function shortMixText(
  weights: MixView["weights"],
  names: ReadonlyMap<string, string>,
): string {
  const skip = names.size > 1 ? commonPrefix(names) : 0;
  const short = (productId: string) => {
    const name = (names.get(productId) ?? productId).split(" ").slice(skip).join(" ");
    return name.length > SHORT_NAME_LENGTH ? `${name.slice(0, SHORT_NAME_LENGTH - 1)}…` : name;
  };
  const biggest = [...weights].sort((a, b) => b.weight - a.weight);
  const text = biggest
    .slice(0, SHORT_MIX_SHOWN)
    .map((row) => `${short(row.productId)} ${formatPercent(row.weight)}`)
    .join(", ");
  return biggest.length > SHORT_MIX_SHOWN ? `${text} +${biggest.length - SHORT_MIX_SHOWN}` : text;
}

/** The gain is small when the typical case moves less than 2% and the chance of success less than 1 point: inside what another set of simulated markets moves. */
const SMALL_GAIN_TYPICAL = 0.02;
const SMALL_GAIN_CHANCE = 0.01;

/** The note next to "Use as contribution weights" when the suggestion is not clearly better; `undefined` when the gain is clear. */
export function smallGainNote(current: MixView, suggested: MixView): string | undefined {
  const typical = suggested.median - current.median;
  const chance = suggested.p - current.p;
  const clear =
    Math.abs(typical) > SMALL_GAIN_TYPICAL * Math.abs(current.median) ||
    Math.abs(chance) >= SMALL_GAIN_CHANCE;
  if (clear) return undefined;
  return `The gain is small: the typical case changes by ${formatSignedAmount(typical)} and the chance of success by ${formatSignedPoints(chance)}. That is inside what another set of simulated markets can move, so the current mix is nearly as good.`;
}

const AXIS_STEP = 0.05;
const AXIS_MARGIN = 0.02;

/** Start of the scatter x-axis: below the lowest chance, in whole steps of 5 points, never below 0. Rounded to 2 decimals: float error (0.7000000000000001) makes ECharts throw. */
export const scatterAxisStart = (lowest: number): number =>
  Math.round(Math.max(0, Math.floor((lowest - AXIS_MARGIN) / AXIS_STEP) * AXIS_STEP) * 100) / 100;

/** The sentence that replaces the scatter when the run holds one mix only. */
export const onlyMixSentence = (
  weights: MixView["weights"],
  names: ReadonlyMap<string, string>,
): string =>
  `Only one mix fits your limits: ${mixText(weights, names)}. There is nothing to compare, so there is no chart.`;

/** A mix as the scatter draws it: `x` is only where the dot sits; the true chance and typical case stay in `mix` and `y`. */
export type SpreadPoint = { mix: MixView; x: number; y: number };

/** How many dots fit side by side in the y-range (so how close in the typical case two dots count as touching), the width of one dot as a fraction of the x-axis, and how many dot widths a dot may be drawn away from its own chance. */
const SPREAD_ROWS = 40;
const SPREAD_LANE = 0.015;
const SPREAD_MAX_LANES = 3;

/**
 * Sets dots that would overlap side by side. Dots are placed in order of typical case; each takes
 * the free spot nearest to its own chance, in steps of one dot width, to the right first and then the
 * left, inside `xMin`..`xMax`. A dot never moves more than three dot widths (a bigger stack overlaps
 * instead) and never crosses `requiredP`: a mix that passes stays at or right of the line, one that
 * fails stays left of it. A dot that touches no other keeps its own chance. Only the drawn `x`
 * moves: `y` is the median and `mix` is the input object, so labels and tooltips keep the true values.
 * The order of the input is kept.
 */
export function spreadMixes(
  mixes: readonly MixView[],
  xMin: number,
  xMax: number,
  requiredP: number,
): SpreadPoint[] {
  const lane = (xMax - xMin) * SPREAD_LANE;
  const medians = mixes.map((mix) => mix.median);
  const reach = (Math.max(...medians) - Math.min(...medians)) / SPREAD_ROWS;
  const points: SpreadPoint[] = mixes.map((mix) => ({ mix, x: mix.p, y: mix.median }));
  const placed: SpreadPoint[] = [];
  const order = [...points].sort((a, b) => a.y - b.y || a.mix.p - b.mix.p);
  for (const point of order) {
    const near = placed.filter((other) => point.y - other.y <= reach);
    const passes = point.mix.p >= requiredP;
    const free = (x: number) =>
      x >= xMin &&
      x <= xMax &&
      (passes ? x >= requiredP : x < requiredP) &&
      near.every((other) => Math.abs(other.x - x) >= lane * 0.99);
    for (let step = 0; step <= 2 * SPREAD_MAX_LANES; step++) {
      const x = point.mix.p + (step % 2 ? (step + 1) / 2 : -step / 2) * lane;
      if (free(x)) {
        point.x = x;
        break;
      }
    }
    placed.push(point);
  }
  return points;
}
