import type { SplitPlan, UnitPart } from "../../engine/split.ts";
import { splitByUnits, splitByWeights } from "../../engine/split.ts";
import { num } from "../forms.ts";

export type SplitMode = "one" | "weights" | "units";

/** A candidate bucket: the goal, its slot colour, and the product's weight in it (0 or none). */
export type Bucket = { goalId: string; name: string; slot: number; weight?: number };

/** What the user has chosen so far. `typed` holds the units text per goal id. */
export type Choice = {
  mode?: SplitMode;
  oneGoalId: string;
  typed: Readonly<Record<string, string>>;
};

export type Proposal =
  | { status: "nothing" }
  | { status: "incomplete"; remaining: number }
  | { status: "invalid"; message: string; remaining?: number }
  | { status: "ready"; plan: SplitPlan };

const plural = (count: number): string => `${count} unit${count === 1 ? "" : "s"}`;

/** The state of the split the user is building: nothing chosen, incomplete, invalid or ready. */
export function propose(
  totalUnits: number,
  commissionCents: number,
  buckets: readonly Bucket[],
  choice: Choice,
): Proposal {
  const ready = (units: readonly UnitPart[]): Proposal => ({
    status: "ready",
    plan: { totalUnits, commissionCents, units },
  });

  switch (choice.mode) {
    case undefined:
      return { status: "nothing" };
    case "one":
      return choice.oneGoalId === ""
        ? { status: "incomplete", remaining: totalUnits }
        : ready([{ goalId: choice.oneGoalId, units: totalUnits }]);
    case "weights": {
      const weights = buckets.map((b) => ({ goalId: b.goalId, weight: b.weight ?? 0 }));
      try {
        return ready(splitByWeights(totalUnits, weights));
      } catch (error) {
        return {
          status: "invalid",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    case "units": {
      const typed = buckets.map((b) => {
        const text = choice.typed[b.goalId] ?? "";
        return { goalId: b.goalId, units: text.trim() === "" ? 0 : num(text) };
      });
      if (typed.some((part) => !Number.isFinite(part.units) || part.units < 0)) {
        return { status: "invalid", message: "Units must be numbers of 0 or more." };
      }
      const result = splitByUnits(totalUnits, typed);
      if (result.ready) return ready(result.parts);
      if (result.remaining > 0) return { status: "incomplete", remaining: result.remaining };
      return {
        status: "invalid",
        message: `${plural(-result.remaining)} too many.`,
        remaining: result.remaining,
      };
    }
  }
}
