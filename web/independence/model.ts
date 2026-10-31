import type { IndependenceView } from "../../engine/independenceView.ts";
import type { FireSettings } from "../../engine/schemas.ts";
import { eurosToCents, num } from "../forms.ts";

/** "P(reached in 20 y)" reads the point at 31 December of Y0 + this many years. */
export const REACH_YEARS = 20;

export const LEVEL_NAMES = ["Level 1 Safety", "Level 2", "Level 3"] as const;
/** The Level 1 wealth leaves the pension out. */
const SAFETY = 0;

export interface LadderSegment {
  goalId: string;
  name: string;
  slot: number;
  isPension: boolean;
  /** Net value today, today's euros. */
  value: number;
}

export interface LadderRow {
  level: number;
  name: string;
  target: number;
  wealth: number;
  /** Wealth ÷ target. Null when the target is 0. */
  progress: number | null;
  segments: LadderSegment[];
  /** The pension's part of the wealth, 0..1. Null when there is no wealth. */
  pensionShare: number | null;
}

/** The three rungs of the ladder, with the wealth of each split by goal. Null without a result. */
export function ladderRows(view: IndependenceView): LadderRow[] | null {
  const { result } = view;
  if (!result) return null;
  return result.levels.map((target, level) => {
    const segments = view.goals
      .filter((goal) => goal.today > 0 && !(level === SAFETY && goal.isPension))
      .map((goal) => ({
        goalId: goal.id,
        name: goal.name,
        slot: goal.slot,
        isPension: goal.isPension,
        value: goal.today,
      }));
    const wealth = segments.reduce((sum, segment) => sum + segment.value, 0);
    const pension = segments.find((segment) => segment.isPension)?.value ?? 0;
    return {
      level,
      name: LEVEL_NAMES[level] ?? `Level ${level + 1}`,
      target,
      wealth,
      progress: target > 0 ? wealth / target : null,
      segments,
      pensionShare: wealth > 0 ? pension / wealth : null,
    };
  });
}

/** The chance a level is reached by 31 December of Y0 + `REACH_YEARS`, and that year. */
export function reachedWithin(
  view: IndependenceView,
  level: number,
): { year: number; p: number } | null {
  const year = Number(view.asOf.slice(0, 4)) + REACH_YEARS;
  const point = view.result?.points.find((candidate) => candidate.year === year);
  return point ? { year, p: point.pReached[level] as number } : null;
}

/** What the number fields hold while the user types. */
export interface Draft {
  l2Mult: string;
  l3Mult: string;
  efMonths: string;
  /** Euros a month. */
  essential: string;
  optional: string;
}

export interface ParsedDraft {
  l2Mult: number;
  l3Mult: number;
  efMonths: number;
  essentialCents: number;
  optionalCents: number;
}

/** The draft as numbers, or null while a field is empty, not a number or negative. */
export function parseDraft(draft: Draft): ParsedDraft | null {
  const values = [draft.l2Mult, draft.l3Mult, draft.efMonths, draft.essential, draft.optional].map(
    num,
  );
  if (values.some((value) => !Number.isFinite(value) || value < 0)) return null;
  return {
    l2Mult: num(draft.l2Mult),
    l3Mult: num(draft.l3Mult),
    efMonths: num(draft.efMonths),
    essentialCents: eurosToCents(draft.essential),
    optionalCents: eurosToCents(draft.optional),
  };
}

/**
 * The numeric FI settings that differ from the stored ones, or null. The save sends only these, so it
 * cannot write back an `efFromGoal` or `includePension` that the user changed meanwhile.
 */
export function changedSettings(
  parsed: ParsedDraft,
  fire: FireSettings,
): Partial<Pick<FireSettings, "l2Mult" | "l3Mult" | "efMonths">> | null {
  const changes: Partial<Pick<FireSettings, "l2Mult" | "l3Mult" | "efMonths">> = {};
  for (const key of ["l2Mult", "l3Mult", "efMonths"] as const) {
    if (parsed[key] !== fire[key]) changes[key] = parsed[key];
  }
  return Object.keys(changes).length === 0 ? null : changes;
}
