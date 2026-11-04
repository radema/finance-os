import { describe, expect, it } from "vitest";
import type { SnapshotGoal, SnapshotView } from "../../engine/snapshot.ts";
import {
  gapText,
  historyOf,
  metricOf,
  scopeKey,
  scopeOfKey,
  scopeQuery,
  xirrNote,
} from "./model.ts";

const goal = (goalId: string, over: Partial<SnapshotGoal> = {}): SnapshotGoal => ({
  goalId,
  prob: 0.8,
  reqP: 0.9,
  detNet: 1000,
  target: 2000,
  median: 1500,
  p10: 1000,
  p90: 2000,
  value: 500,
  status: "at_risk",
  ...over,
});

const snapshot = (month: string, source: SnapshotView["source"], goals: SnapshotGoal[]) => ({
  id: month,
  month,
  source,
  assumptionsHash: "h",
  goals,
});

describe("metricOf", () => {
  it("reads P, the funded ratio (value / target) and median / target", () => {
    const g = goal("a");
    expect(metricOf(g, "prob")).toBe(0.8);
    expect(metricOf(g, "funded")).toBe(0.25);
    expect(metricOf(g, "median")).toBe(0.75);
  });

  it("is null when a part is missing, and never divides by a zero target", () => {
    expect(metricOf(goal("a", { prob: null }), "prob")).toBeNull();
    expect(metricOf(goal("a", { value: null }), "funded")).toBeNull();
    expect(metricOf(goal("a", { median: null }), "median")).toBeNull();
    expect(metricOf(goal("a", { target: 0 }), "funded")).toBeNull();
  });
});

describe("historyOf", () => {
  const snapshots = [
    snapshot("2026-02", "saved", [goal("a", { prob: 0.7 }), goal("b", { prob: null })]),
    snapshot("2026-01", "recomputed", [goal("a", { prob: 0.6 }), goal("b", { prob: 0.5 })]),
  ];

  it("orders months and gives one line per goal, a gap where the metric is null", () => {
    const history = historyOf(snapshots, "prob");
    expect(history.months).toEqual(["2026-01", "2026-02"]);
    expect(history.recomputed).toEqual([true, false]);
    expect(history.lines).toEqual([
      { goalId: "a", values: [0.6, 0.7] },
      { goalId: "b", values: [0.5, null] },
    ]);
  });

  it("puts a goal that appears later on its own months", () => {
    const later = [
      snapshot("2026-01", "saved", [goal("a")]),
      snapshot("2026-02", "saved", [goal("a"), goal("c", { prob: 0.4 })]),
    ];
    expect(historyOf(later, "prob").lines[1]).toEqual({ goalId: "c", values: [null, 0.4] });
  });

  it("is empty without snapshots", () => {
    expect(historyOf([], "prob")).toEqual({ months: [], recomputed: [], lines: [] });
  });
});

describe("scope keys", () => {
  it("round-trips the three kinds of scope, and a goal id with odd characters", () => {
    for (const scope of [
      { kind: "all" },
      { kind: "allExceptPension" },
      { kind: "bucket", goalId: "g-car" },
      { kind: "bucket", goalId: "a b&c" },
    ] as const) {
      expect(scopeOfKey(scopeKey(scope))).toEqual(scope);
    }
  });

  it("builds the query of the performance route", () => {
    expect(scopeQuery({ kind: "all" })).toBe("scope=all");
    expect(scopeQuery({ kind: "bucket", goalId: "a b" })).toBe("scope=bucket&goalId=a+b");
  });
});

describe("texts", () => {
  it("says how far a goal is from its plan, in cents", () => {
    expect(gapText(-12_000)).toBe("behind");
    expect(gapText(500)).toBe("ahead");
    expect(gapText(0)).toBe("on plan");
  });

  it("explains an XIRR that is not there", () => {
    expect(xirrNote(null)).toMatch(/no annual rate/i);
    expect(xirrNote(0.05)).toBeUndefined();
  });
});
