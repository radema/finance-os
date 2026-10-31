import type { Goal, Settings } from "./schemas.ts";

export type GoalStatus = "on_track" | "at_risk" | "off_track";

const POINTS = 100;
// A gap of exactly the band, such as 75% - 15 points, is not exact in floating point.
const EPSILON = 1e-9;

/** The probability the goal must reach: its own `minProb`, else the default of its priority. */
export function requiredProbability(
  goal: Pick<Goal, "priority" | "minProb">,
  defaults: Settings["requiredProb"],
): number {
  if (goal.minProb !== null) return goal.minProb;
  if (goal.priority === "Need") return defaults.need;
  return goal.priority === "Want" ? defaults.want : defaults.wish;
}

/**
 * On track when P ≥ the required probability. At risk when P is below it by no more than `band`
 * points: the exact boundary counts as at risk. Else off track.
 *
 * @param pSuccess P(success) as a fraction, 0 to 1.
 * @param requiredP The required probability as a fraction.
 * @param band Settings `statusBandPoints`, in percentage points (15).
 */
export function goalStatus(pSuccess: number, requiredP: number, band: number): GoalStatus {
  if (pSuccess >= requiredP) return "on_track";
  return (requiredP - pSuccess) * POINTS <= band + EPSILON ? "at_risk" : "off_track";
}
