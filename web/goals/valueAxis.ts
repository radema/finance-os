import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";

echarts.use([LabelLayout]);

/** The bad case is at most this share of the good case: the axis starts at 0. */
const ZERO_BASE_SHARE = 0.2;
/** Ticks aimed for across the axis. */
const TICKS = 5;
/** Space above and below a fitted axis, as a share of the data range. */
const PADDING = 0.1;
/** Tick steps, as multiples of a power of ten. */
const STEPS = [1, 2, 5, 10];

/** Series `labelLayout`: end labels that would overprint slide apart, up or down, and stay in order. */
export const SPREAD_END_LABELS = { moveOverlap: "shiftY" as const };

export interface ValueAxis {
  min: number;
  max: number;
  interval: number;
}

function niceStep(span: number): number {
  const raw = span / TICKS;
  const power = 10 ** Math.floor(Math.log10(raw));
  return (STEPS.find((step) => step * power >= raw) as number) * power;
}

/**
 * The value axis for a series that runs from `low` (the bad case) to `high` (the good case):
 * it starts at 0 only when `low` is at most 20% of `high`, otherwise it is fitted to the data.
 * `marks` (such as a target line) widen the axis but do not move the 0 rule.
 */
export function fitAxis(low: number, high: number, ...marks: number[]): ValueAxis {
  const lo = Math.min(low, ...marks);
  const hi = Math.max(high, ...marks);
  const fromZero = low <= ZERO_BASE_SHARE * high;
  const spread = hi - lo || Math.abs(hi) * PADDING || 1;
  const from = fromZero ? Math.min(0, lo) : lo - spread * PADDING;
  const to = hi + (fromZero ? 0 : spread * PADDING);
  let interval = niceStep(Math.max(to - from, spread));
  let min = Math.floor(from / interval) * interval;
  // The fit landed on 0 by rounding: use finer ticks, so the axis starts at 0 only by the rule.
  // A mark that pulls `from` to 0 or below does start at 0.
  while (from > 0 && min <= 0) {
    interval /= 2;
    min = Math.floor(from / interval) * interval;
  }
  return {
    min: lo >= 0 ? Math.max(0, min) : min,
    max: Math.ceil(to / interval) * interval,
    interval,
  };
}
