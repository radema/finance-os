import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { IndependenceView } from "../../engine/independenceView.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { fractionToPercent } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatAmount, formatPercent } from "../money.ts";
import {
  Alert,
  Card,
  CheckField,
  Field,
  NumberField,
  RequiredLegend,
  Resource,
} from "../setup/ui.tsx";
import { FanChart } from "./FiCharts.tsx";
import {
  changedSettings,
  type Draft,
  HORIZON_YEARS,
  type LevelTile,
  levelLinesNote,
  levelTiles,
  parseDraft,
  REACH_YEARS,
  reachedWithin,
  reachTitle,
} from "./model.ts";

const SAVE_DELAY_MS = 300;
const MISSING = "–";
const MONTHS = "";

const percentOrMissing = (fraction: number | null) =>
  fraction === null ? MISSING : formatPercent(fraction);
const NEVER = `Not within ${HORIZON_YEARS} years`;
const yearOrNever = (year: number | null) => (year === null ? NEVER.toLowerCase() : String(year));

const draftOf = (view: IndependenceView): Draft => ({
  l2Mult: String(view.fire.l2Mult),
  l3Mult: String(view.fire.l3Mult),
  efMonths: String(view.fire.efMonths),
  essential: String(view.expenses.essentialCents / 100),
  optional: String(view.expenses.optionalCents / 100),
});

const slotStyle = (slot: number) => ({ "--slot": `var(--slot${slot})` }) as CSSProperties;

function Tiles({ view, tiles }: { view: IndependenceView; tiles: LevelTile[] }) {
  const reachYear = reachedWithin(view, 0)?.year;
  return (
    <>
      <div className="kpis">
        {tiles.map((tile) => (
          <section className="kpi level-tile" key={tile.name} aria-label={tile.name}>
            <div className="kpi-label">{tile.name}</div>
            <div className={tile.typical === null ? "kpi-value level-none" : "kpi-value"}>
              {tile.set ? (tile.typical ?? NEVER) : "Not set"}
            </div>
            {tile.set ? (
              <div className="sub">
                <TermPopover term="typical">Typical case</TermPopover>
              </div>
            ) : null}
            {tile.set ? (
              <dl className="level-rows">
                <div>
                  <dt>Deterministic</dt>
                  <dd>{yearOrNever(tile.deterministic)}</dd>
                </div>
                <div>
                  <dt>
                    <TermPopover term="prob">Chance</TermPopover> reached in {REACH_YEARS} years
                  </dt>
                  <dd>{percentOrMissing(tile.chance)}</dd>
                </div>
                <div>
                  <dt>Target, today's euros</dt>
                  <dd>{formatAmount(tile.target)}</dd>
                </div>
              </dl>
            ) : null}
          </section>
        ))}
      </div>
      {tiles.some((tile) => tile.set) ? (
        <p className="sub">
          Targets are in <TermPopover term="real">today’s euros</TermPopover>. The chance is read at
          31 December {reachYear}. Level 1 does not count the pension.
        </p>
      ) : null}
    </>
  );
}

function Chart({ view, tiles }: { view: IndependenceView; tiles: LevelTile[] }) {
  const { result } = view;
  if (!result) return null;
  // With every target at 0 there is nothing to chart: ask for the expenses.
  if (tiles.every((tile) => !tile.set)) {
    return (
      <p className="unit">Set your expenses below to see the levels and when you reach them.</p>
    );
  }
  const last = result.points.at(-1);
  return (
    <figure className="exhibit">
      <div className="tag">Wealth and levels</div>
      <h2 className="exhibit-title">{reachTitle(tiles)}</h2>
      <p className="unit">
        Euros today, net of liquidation tax, to {last?.year}.{" "}
        {levelLinesNote(view.expenses.expenseGrowth)}
      </p>
      <ul className="legend">
        <li>
          <span className="swatch swatch-fi-band" />
          <TermPopover term="badcase">Bad case</TermPopover> to{" "}
          <TermPopover term="goodcase">good case</TermPopover>
        </li>
        <li>
          <span className="swatch swatch-solid" />
          <TermPopover term="typical">Typical case</TermPopover>
        </li>
        <li>
          <span className="swatch swatch-level" />
          Level target
        </li>
      </ul>
      <FanChart result={result} label="FI wealth by year, with the three level targets" />
      <figcaption className="source">
        Source: Monte Carlo on your goals, assumptions and seed.
      </figcaption>
    </figure>
  );
}

function Settings({
  view,
  onView,
}: {
  view: IndependenceView;
  onView: (view: IndependenceView) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(view));
  const [error, setError] = useState<string>();
  // A response that arrives after a newer request is dropped.
  const sequence = useRef(0);
  const latest = useRef(view);
  latest.current = view;

  const send = async (path: string, body: unknown) => {
    const mine = ++sequence.current;
    try {
      const next = await api<IndependenceView>("PUT", path, { body });
      if (mine === sequence.current) {
        onView(next);
        setError(undefined);
      }
    } catch (failure) {
      if (mine === sequence.current) setError(messageOf(failure));
    }
  };

  // Typing saves after a short pause, once every field is a valid number.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the draft saves
  useEffect(() => {
    const parsed = parseDraft(draft);
    if (!parsed) return;
    const timer = setTimeout(async () => {
      // The stored values at the time of the save, not at the render that changed the draft.
      const { fire, expenses } = latest.current;
      const changes = changedSettings(parsed, fire);
      if (changes) await send("/api/independence/settings", changes);
      if (
        parsed.essentialCents !== expenses.essentialCents ||
        parsed.optionalCents !== expenses.optionalCents
      ) {
        await send("/api/independence/expenses", {
          essentialCents: parsed.essentialCents,
          optionalCents: parsed.optionalCents,
        });
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft]);

  const set = (key: keyof Draft) => (value: string) => setDraft({ ...draft, [key]: value });
  const { fire } = view;

  return (
    <Card title="Settings" note="Changes save as you type, and the levels update at once.">
      <Alert message={error} />
      <RequiredLegend />
      <div className="form-grid">
        <NumberField
          label="Essential expenses a month (€)"
          value={draft.essential}
          onChange={set("essential")}
          required
        />
        <NumberField
          label="Optional expenses a month (€)"
          value={draft.optional}
          onChange={set("optional")}
          required
        />
      </div>
      <details className="level-rules">
        <summary>Level rules: multipliers, Level 1 source, pension</summary>
        <div className="form-grid">
          <NumberField
            label="Level 2 multiplier (months of essential)"
            value={draft.l2Mult}
            onChange={set("l2Mult")}
            required
          />
          <NumberField
            label="Level 3 multiplier (months of optional, added to Level 2)"
            value={draft.l3Mult}
            onChange={set("l3Mult")}
            required
          />
          <Field label="Level 1 comes from">
            <select
              value={fire.efFromGoal ?? MONTHS}
              onChange={(event) =>
                void send("/api/independence/settings", {
                  efFromGoal: event.target.value === MONTHS ? null : event.target.value,
                })
              }
            >
              <option value={MONTHS}>Months of essential expenses</option>
              {view.goals.map((goal) => (
                <option key={goal.id} value={goal.id}>
                  Target of {goal.name}
                </option>
              ))}
            </select>
          </Field>
          <NumberField
            label="Months of essential expenses"
            value={draft.efMonths}
            onChange={set("efMonths")}
            required
            hint={
              fire.efFromGoal === null ? undefined : "Not used while Level 1 comes from a goal."
            }
          />
        </div>
        <CheckField
          label="Include the pension in the wealth"
          checked={fire.includePension}
          onChange={(includePension) => void send("/api/independence/settings", { includePension })}
        />
      </details>
      <p className="sub">
        Expenses grow {fractionToPercent(view.expenses.expenseGrowth)}% a year above inflation; 0%
        keeps up with prices. Change it on the Cash flow screen.
      </p>
    </Card>
  );
}

function WhatCounts({
  view,
  onView,
}: {
  view: IndependenceView;
  onView: (view: IndependenceView) => void;
}) {
  const [error, setError] = useState<string>();
  const toggle = async (id: string, countsTowardFi: boolean) => {
    try {
      onView(
        await api<IndependenceView>("PUT", "/api/independence/counts", {
          body: { id, countsTowardFi },
        }),
      );
      setError(undefined);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  return (
    <Card
      title="What counts"
      note="A ticked goal's net value counts toward your independence wealth."
    >
      <Alert message={error} />
      <ul className="counts">
        {view.goals.map((goal) => (
          <li key={goal.id} style={slotStyle(goal.slot)}>
            <CheckField
              label={goal.name}
              checked={goal.countsTowardFi}
              onChange={(checked) => void toggle(goal.id, checked)}
            />
            <span className="counts-value">
              {goal.countsTowardFi ? formatAmount(goal.today) : MISSING}
              {goal.isPension ? " pension" : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Screen({
  view,
  onView,
}: {
  view: IndependenceView;
  onView: (view: IndependenceView) => void;
}) {
  const tiles = levelTiles(view);
  if (view.goals.length === 0) {
    return (
      <>
        <div className="tag">Independence</div>
        <h1 className="title">Independence</h1>
        <p className="unit">
          There are no goals yet. Add goals in <a href="#/setup/goals">Setup</a>, tick the ones that
          count, and the levels show here.
        </p>
      </>
    );
  }
  return (
    <>
      <div className="tag">Independence</div>
      <h1 className="title">Independence</h1>
      <p className="unit">
        Three <TermPopover term="fire">levels</TermPopover> of wealth, in today's euros. Values at
        the end of {view.asOf.slice(0, 7)}.
      </p>
      {view.note ? <p className="alert">{view.note}</p> : null}
      {tiles ? (
        <>
          <Tiles view={view} tiles={tiles} />
          <Chart view={view} tiles={tiles} />
        </>
      ) : null}
      <div className="independence-controls">
        <WhatCounts view={view} onView={onView} />
        <Settings view={view} onView={onView} />
      </div>
    </>
  );
}

/** Independence: the three FI levels, when you reach each one, and the settings behind them. */
export function IndependenceScreen() {
  const loaded = useLoad<IndependenceView>("/api/independence");
  return (
    <Resource loaded={loaded}>{(view) => <Screen view={view} onView={loaded.set} />}</Resource>
  );
}
