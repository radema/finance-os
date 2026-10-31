import type { GoalStatus } from "../../engine/goalStatus.ts";
import type { RequiredContributions } from "../../engine/goalViews.ts";
import { formatAmount, formatPercent } from "../money.ts";

const MONTHS_PER_YEAR = 12;
const years = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const multiple = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });

const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

export const statusLabel = (status: GoalStatus): string => STATUS_LABELS[status];

/** P(success) against the probability the goal must reach, both fractions. */
export const pVsRequired = (pSuccess: number, requiredP: number): string =>
  `${formatPercent(pSuccess)} vs ${formatPercent(requiredP)} required`;

/** What the goal needs: an amount, a multiple of the pension schedule, or "not reachable" when `null`. */
export function requiredText(amount: number | null, unit: RequiredContributions["unit"]): string {
  if (amount === null) return "not reachable";
  if (amount === 0) return "no contribution needed";
  return unit === "monthly"
    ? `${formatAmount(amount)} a month`
    : `${multiple.format(amount)} times the current schedule`;
}

/** Real years to the goal date, in months when it is under a year. */
export function horizonText(horizonYears: number): string {
  if (horizonYears <= 0) return "now";
  if (horizonYears < 1) {
    const months = Math.max(1, Math.round(horizonYears * MONTHS_PER_YEAR));
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  return `${years.format(horizonYears)} ${horizonYears === 1 ? "year" : "years"}`;
}

/** DESIGN.md: lines use only the goal colours of slots 1, 2 and 5. Other goals draw their lines in grey. */
const LINE_SLOTS = [1, 2, 5];
export const usesSlotLine = (slot: number): boolean => LINE_SLOTS.includes(slot);
