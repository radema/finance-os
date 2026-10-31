const MONTHS_PER_YEAR = 12;

/** One projection step: a calendar year of the goal, `fraction` of it still to run. */
export type Step = {
  year: number;
  /** 1 for a full year, the fraction `f` for the stub of Y0. */
  fraction: number;
  /** Months of contribution at the end of the step: `r` for the stub, 12 for a full year. */
  months: number;
};

export type TimeGrid = {
  y0: number;
  /** Months left in Y0 after the asOf month. */
  r: number;
  f: number;
  steps: readonly Step[];
  /** Real years from asOf to the goal date (31 December of targetYear). */
  tau: number;
};

/** The spec's time grid. `asOf` is an ISO date, YYYY-MM-DD; the engine never reads the clock. */
export function timeGrid(asOf: string, targetYear: number): TimeGrid {
  const y0 = Number(asOf.slice(0, 4));
  const r = MONTHS_PER_YEAR - Number(asOf.slice(5, 7));
  const f = r / MONTHS_PER_YEAR;
  if (targetYear < y0) return { y0, r, f, steps: [], tau: 0 };

  const steps: Step[] = [{ year: y0, fraction: f, months: r }];
  for (let year = y0 + 1; year <= targetYear; year++) {
    steps.push({ year, fraction: 1, months: MONTHS_PER_YEAR });
  }
  return { y0, r, f, steps, tau: f + (targetYear - y0) };
}
