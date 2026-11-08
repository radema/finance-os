import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GoalListRow } from "../../engine/goalViews.ts";
import type { IndependenceView } from "../../engine/independenceView.ts";
import type { OverviewView } from "../../engine/overviewView.ts";
import { FiCell, GoalsCell, OperationalCell, PlanCell } from "./cells.tsx";
import { Dashboard } from "./OverviewScreen.tsx";

const goal = (id: string, status: "on_track" | "at_risk" | "off_track" | null): GoalListRow => ({
  id,
  name: id,
  priority: "Need",
  slot: 2,
  target: 100,
  value: 50,
  missingPrices: false,
  outlook: status && { status, pSuccess: 0.8, requiredP: 0.9 },
});
const fi = (levels: number[] | null): IndependenceView => ({
  asOf: "2026-10-31",
  fire: {} as never,
  expenses: { essentialCents: 0, optionalCents: 0, expenseGrowth: 0 },
  inflation: 0,
  goals: [{ id: "g", name: "Goal", slot: 2, isPension: false, today: 18000 } as never],
  result:
    levels &&
    ({
      levels,
      points: [{ year: 2066 }],
      reached: [
        { median: 2026, deterministic: 2026 },
        { median: 2040, deterministic: 2041 },
        { median: null, deterministic: null },
      ],
    } as never),
  note: null,
});
const plan: OverviewView["plan"] = { trackingStart: "2026-01", latest: null, next: null };

describe("Overview dashboard", () => {
  it("renders four blocks and preserves the five key numbers", () => {
    const view: OverviewView = {
      asOf: "2026-10-31",
      keyNumbers: { netWorth: null, marketChange: null, ytdTwr: null, fiWealth: null },
      goals: [],
      fi: fi(null),
      plan,
      stalePrices: [],
    };
    const html = renderToStaticMarkup(<Dashboard view={view} />);
    expect(html.match(/<section class="card cell"/g)).toHaveLength(4);
    for (const label of [
      "Goals",
      "Plan vs actual",
      "Operational",
      "Financial independence",
      "Net worth",
      "Market change this month",
      "TWR",
      "FI wealth",
      "Goals on track",
    ])
      expect(html).toContain(label);
  });
  it("orders all goals by status with stable ties and no analysis last", () => {
    const html = renderToStaticMarkup(
      <GoalsCell
        goals={[
          goal("late", null),
          goal("good", "on_track"),
          goal("bad1", "off_track"),
          goal("risk", "at_risk"),
          goal("bad2", "off_track"),
        ]}
      />,
    );
    const positions = ["bad1", "bad2", "risk", "good", "late"].map((id) =>
      html.indexOf(`>${id}</a>`),
    );
    expect(positions.every((value) => value >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("80% vs 90% required");
    expect(html).toContain("No analysis");
  });
  it("shows plan gaps and contribution advice", () => {
    expect(renderToStaticMarkup(<PlanCell plan={plan} />)).toContain("No tracking months yet");
    for (const [gap, text] of [
      [-100, "behind"],
      [100, "ahead"],
      [0, "on plan"],
    ] as const) {
      const html = renderToStaticMarkup(
        <PlanCell
          plan={{
            ...plan,
            latest: {
              month: "2026-01",
              planned: 100,
              actual: 0,
              cumPlanned: 100,
              cumActual: 100 + gap,
              gap,
            },
            next: {
              goalId: "g",
              goalName: "Goal",
              slot: 2,
              amount: 100,
              wait: true,
              minTicket: 200,
            },
          }}
        />,
      );
      expect(html).toContain(text);
      expect(html).toContain("below the minimum efficient ticket");
    }
  });
  it("keeps stale work visible on alert errors and only shows clear after a successful load", () => {
    const props = {
      alerts: undefined,
      loading: false,
      loadError: "Failed",
      onRetry: () => {},
      dismissError: undefined,
      stalePrices: [{ productId: "p", name: "Old fund", age: { old: true, reason: "Old" } }],
      onDismiss: () => {},
    };
    const error = renderToStaticMarkup(<OperationalCell {...props} />);
    expect(error).toContain("Failed");
    expect(error).toContain("Try again");
    expect(error).toContain("Old fund");
    expect(error).not.toContain("Nothing needs attention");
    const clear = renderToStaticMarkup(
      <OperationalCell {...props} loadError={undefined} alerts={[]} stalePrices={[]} />,
    );
    expect(clear).toContain("Nothing needs attention");
    expect(clear).toContain('<a href="#/operations/prices">View prices</a>');
    expect(
      renderToStaticMarkup(
        <OperationalCell {...props} loadError={undefined} loading stalePrices={[]} />,
      ),
    ).not.toContain("Nothing needs attention");
  });
  it("handles FI projection, expenses, next level and all reached", () => {
    const missing = renderToStaticMarkup(<FiCell fi={fi(null)} />);
    const unset = renderToStaticMarkup(<FiCell fi={fi([0, 0, 0])} />);
    expect(missing).toContain("no projection");
    expect(unset).toContain("Set your expenses");
    expect(missing).not.toContain('role="img"');
    expect(unset).not.toContain('role="img"');
    const next = renderToStaticMarkup(<FiCell fi={fi([12000, 300000, 400000])} />);
    expect(next).toContain("Highest level reached today");
    expect(next).toContain("2040");
    expect(next).toContain('role="img" aria-label="FI wealth by year, with the level targets"');
    expect(next).toContain("2066");
    expect(renderToStaticMarkup(<FiCell fi={fi([1000, 2000, 3000])} />)).toContain(
      "All configured levels reached",
    );
  });
});
