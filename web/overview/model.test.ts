import { describe, expect, it } from "vitest";
import type { GoalListRow } from "../../engine/goalViews.ts";
import type { Alert, RuleId } from "../../engine/rules.ts";
import { goalIdOf, isBuilt } from "../nav.ts";
import {
  actionTitle,
  alertRoute,
  goalsOnTrack,
  levelRows,
  OVERVIEW_ROUTES,
  signedAmount,
} from "./model.ts";

const row = (id: string, status: "on_track" | "at_risk" | "off_track" | null): GoalListRow => ({
  id,
  name: id,
  priority: "Need",
  slot: 2,
  target: 1,
  value: 0,
  missingPrices: false,
  outlook: status && { status, pSuccess: 0.8, requiredP: 0.8 },
});

describe("goalsOnTrack", () => {
  it("counts the on-track goals among the goals that have a status", () => {
    expect(goalsOnTrack([row("a", "on_track"), row("b", "at_risk"), row("c", null)])).toEqual({
      onTrack: 1,
      total: 2,
    });
  });
});

describe("actionTitle", () => {
  it("states the count of goals on track and the net worth, with numbers", () => {
    expect(actionTitle({ onTrack: 3, total: 4 }, 148_898.2)).toBe(
      "3 of 4 goals are on track, and net worth is 148.898,20 €",
    );
    expect(actionTitle({ onTrack: 1, total: 1 }, 100)).toContain("1 of 1 goal is on track");
  });

  it("falls back to the net worth, then to a plain statement", () => {
    expect(actionTitle({ onTrack: 0, total: 0 }, 100)).toBe("Net worth is 100,00 €");
    expect(actionTitle({ onTrack: 0, total: 0 }, null)).toBe("No numbers to show yet");
  });

  it("never reads as an instruction", () => {
    expect(actionTitle({ onTrack: 2, total: 5 }, 10)).not.toMatch(
      /\b(should|must|add|buy|sell)\b/i,
    );
  });
});

describe("signedAmount", () => {
  it("writes the sign of a change, and a dash when there is none", () => {
    expect(signedAmount(-1_240.88)).toBe("-1.240,88 €");
    expect(signedAmount(100)).toBe("+100,00 €");
    expect(signedAmount(null)).toBe("–");
  });
});

describe("links", () => {
  const RULE_IDS: RuleId[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"];
  const alert = (ruleId: RuleId, kind: Alert["scope"]["kind"]): Alert => ({
    ruleId,
    name: "x",
    severity: "Info",
    condition: "x",
    scope: { kind, id: kind === "none" ? "" : "g-car" },
    key: "k",
  });

  it("sends every number to a built screen", () => {
    for (const route of Object.values(OVERVIEW_ROUTES)) expect(isBuilt(route)).toBe(true);
  });

  it("sends every alert of every rule, whatever its scope, to a built screen", () => {
    for (const ruleId of RULE_IDS) {
      for (const kind of ["goal", "product", "none"] as const) {
        const route = alertRoute(alert(ruleId, kind));
        expect(isBuilt(route) || goalIdOf(route) !== undefined, `${ruleId} ${kind}`).toBe(true);
      }
    }
  });

  it("sends a goal's alert to the goal's detail", () => {
    expect(alertRoute(alert("R6", "goal"))).toBe("goals/detail/g-car");
  });
});

describe("levelRows", () => {
  it("is empty without a projection", () => {
    expect(
      levelRows({
        asOf: "2026-10-31",
        fire: {} as never,
        expenses: { essentialCents: 0, optionalCents: 0, expenseGrowth: 0 },
        inflation: 0,
        goals: [],
        result: null,
        note: null,
      }),
    ).toEqual([]);
  });
});
