// What the range-of-outcomes charts need beyond the simulation: the fitted axis and the outcome bins.
// Pure: no I/O. Amounts are euros as floats; the same axis rule also runs on shares of a target.

/** A fitted axis: both ends are multiples of `step`, the distance between two ticks. */
export interface Axis {
  min: number;
  max: number;
  step: number;
}

/** Simulated paths counted in equal bins from `min` to `max`: bin `i` covers `[min + i·w, min + (i+1)·w)`. */
export interface OutcomeBins {
  min: number;
  max: number;
  counts: number[];
}

/** The axis starts at 0 only when the bad case is at most this share of the good case. */
const ZERO_START_SHARE = 0.2;
/** Room added each side of the data, as a share of its span, so the tails of a distribution show. */
const PAD_SHARE = 0.5;
/** About this many ticks across the axis. */
const TICKS = 4;
const HALF_CENT = 0.005;
const PRECISION = 12;

/** The largest 1, 2 or 5 times a power of ten that is at most `size`. */
function niceStepBelow(size: number): number {
  if (!(size > 0)) return 1;
  const unit = 10 ** Math.floor(Math.log10(size));
  const lead = size / unit;
  return (lead >= 5 ? 5 : lead >= 2 ? 2 : 1) * unit;
}

const clean = (value: number): number => Number(value.toPrecision(PRECISION));

/** True when the bad and good case are the same to the cent: there is no range to draw. */
export const isZeroWidth = ({ bad, good }: { bad: number; good: number }): boolean =>
  Math.abs(good - bad) < HALF_CENT;

/**
 * An axis that holds the bad case, the good case and every mark (the target). It starts at 0 only
 * when the bad case is at most 20% of the good case; otherwise it starts above 0 so the range is
 * not squeezed into the right of the chart. Ends are rounded outward to a 1, 2 or 5 step.
 *
 * @param bad The low end of the range.
 * @param good The high end of the range.
 * @param marks Further values the axis must hold, such as the target.
 */
export function fitAxis(bad: number, good: number, marks: readonly number[] = []): Axis {
  const low = Math.min(bad, ...marks);
  const high = Math.max(good, ...marks);
  const span = high - low || Math.abs(high) || 1;
  const startsAtZero = bad <= good * ZERO_START_SHARE;
  // Above the zero rule the axis must stay above 0, so the padding cannot reach it.
  const pad = startsAtZero ? PAD_SHARE * span : Math.min(PAD_SHARE * span, Math.max(low, 0) / 2);
  const start = startsAtZero ? 0 : low - pad;
  const end = high + pad;
  const wide = (end - start) / TICKS;
  const step = niceStepBelow(start > 0 ? Math.min(wide, start) : wide);
  return {
    min: startsAtZero ? 0 : clean(Math.floor(start / step) * step),
    max: clean(Math.ceil(end / step) * step),
    step,
  };
}

/**
 * Counts net values in equal bins across the axis. A value outside the axis is not counted, so a
 * far tail does not pile up in an edge bin.
 *
 * @param sorted Net values, ascending.
 * @param axis The axis the bins cover.
 * @param count Number of bins.
 */
export function binOutcomes(sorted: readonly number[], axis: Axis, count: number): OutcomeBins {
  const { min, max } = axis;
  const width = (max - min) / count;
  const counts = new Array<number>(count).fill(0);
  for (const value of sorted) {
    if (value < min || value > max) continue;
    counts[Math.min(Math.floor((value - min) / width), count - 1)]++;
  }
  return { min, max, counts };
}
