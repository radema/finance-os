import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { IndependenceView } from "../../engine/independenceView.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { fractionToPercent } from "../forms.ts";
import { formatAmount, formatPercent } from "../money.ts";
import { Alert, Card, CheckField, Field, NumberField, Resource } from "../setup/ui.tsx";
import { FanChart, ProgressChart } from "./FiCharts.tsx";
import {
  type Draft,
  type LadderRow,
  LEVEL_NAMES,
  ladderRows,
  parseDraft,
  REACH_YEARS,
  reachedWithin,
} from "./model.ts";

const SAVE_DELAY_MS = 300;
const MISSING = "–";
const MONTHS = "";

const percentOrMissing = (fraction: number | null) =>
  fraction === null ? MISSING : formatPercent(fraction);
const yearOrNever = (year: number | null) => (year === null ? "not within 40 years" : String(year));

const draftOf = (view: IndependenceView): Draft => ({
  l2Mult: String(view.fire.l2Mult),
  l3Mult: String(view.fire.l3Mult),
  efMonths: String(view.fire.efMonths),
  essential: String(view.expenses.essentialCents / 100),
  optional: String(view.expenses.optionalCents / 100),
});

const slotStyle = (slot: number) => ({ "--slot": `var(--slot${slot})` }) as CSSProperties;

function Bar({ row }: { row: LadderRow }) {
  // The bar is drawn to the target: a level that is more than reached is full.
  const scale = Math.max(row.target, row.wealth);
  return (
    <div
      className="ladder-bar"
      role="img"
      aria-label={`${row.name}: ${percentOrMissing(row.progress)} reached`}
    >
      {row.segments.map((segment) => (
        <span
          key={segment.goalId}
          className="ladder-seg"
          style={{ ...slotStyle(segment.slot), width: `${(segment.value / scale) * 100}%` }}
          title={`${segment.name}: ${formatAmount(segment.value)}`}
        />
      ))}
    </div>
  );
}

function Ladder({ view, rows }: { view: IndependenceView; rows: LadderRow[] }) {
  const used = view.goals.filter((goal) => goal.today > 0);
  const progress = rows[1]?.progress ?? null;
  return (
    <figure className="exhibit">
      <div className="tag">Independence levels</div>
      <h2 className="exhibit-title">
        {progress === null
          ? "Set your expenses to see how far you are from the levels"
          : `You have ${formatPercent(progress)} of Level 2 today, ${formatAmount(rows[1]?.wealth ?? 0)} of ${formatAmount(rows[1]?.target ?? 0)}`}
      </h2>
      <p className="unit">
        Euros today, net of liquidation tax. The pension counts in Levels 2 and 3 only.
      </p>
      <ul className="legend">
        {used.map((goal) => (
          <li key={goal.id}>
            <span className="swatch swatch-box" style={slotStyle(goal.slot)} />
            {goal.name}
            {goal.isPension ? " (pension)" : ""}
          </li>
        ))}
        {used.length === 0 ? <li>No goal counts toward FI yet.</li> : null}
      </ul>
      <div className="ladder">
        {rows.map((row) => (
          <div className="ladder-row" key={row.level}>
            <div className="ladder-name">{row.name}</div>
            <Bar row={row} />
            <div className="ladder-figures">
              <strong>{percentOrMissing(row.progress)}</strong> of {formatAmount(row.target)}
              {row.pensionShare !== null && row.level !== 0 ? (
                <span className="sub-line">
                  Pension share {formatPercent(row.pensionShare)} of the wealth.
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="source">
        Source: your holdings and prices, the goals ticked below, and your expense split.
      </figcaption>
    </figure>
  );
}

function LevelsTable({ view }: { view: IndependenceView }) {
  const { result } = view;
  if (!result) return null;
  const reachYear = reachedWithin(view, 0)?.year;
  return (
    <Card title="Levels">
      <table className="table">
        <thead>
          <tr>
            <th>Level</th>
            <th className="num">Target</th>
            <th className="num">Progress</th>
            <th className="num">Year reached, deterministic</th>
            <th className="num">Year reached, typical case</th>
            <th className="num">Chance reached in {REACH_YEARS} years</th>
          </tr>
        </thead>
        <tbody>
          {result.levels.map((target, level) => (
            <tr key={LEVEL_NAMES[level]}>
              <th scope="row">{LEVEL_NAMES[level]}</th>
              <td className="num">{formatAmount(target)}</td>
              <td className="num">{percentOrMissing(result.points[0]?.progress[level] ?? null)}</td>
              <td className="num">
                {target === 0 ? MISSING : yearOrNever(result.reached[level]?.deterministic ?? null)}
              </td>
              <td className="num">
                {target === 0 ? MISSING : yearOrNever(result.reached[level]?.median ?? null)}
              </td>
              <td className="num">
                {target === 0 ? MISSING : percentOrMissing(reachedWithin(view, level)?.p ?? null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sub">
        Target and progress are in today's euros. The chance is read at 31 December {reachYear}.
        Level 1 does not count the pension.
      </p>
    </Card>
  );
}

function Charts({ view }: { view: IndependenceView }) {
  const { result } = view;
  // With every target at 0 there is nothing to chart: the ladder already asks for the expenses.
  if (!result || result.levels.every((target) => target === 0)) return null;
  const last = result.points.at(-1);
  const level2 = result.reached[1];
  return (
    <>
      <figure className="exhibit">
        <div className="tag">Wealth and levels</div>
        <h2 className="exhibit-title">
          {level2?.median === null || level2 === undefined
            ? "The typical case does not reach Level 2 within 40 years"
            : `The typical case reaches Level 2 in ${level2.median}`}
        </h2>
        <p className="unit">Euros today, net of liquidation tax, to {last?.year}.</p>
        <ul className="legend">
          <li>
            <span className="swatch swatch-band" />
            Bad case to good case
          </li>
          <li>
            <span className="swatch swatch-solid" />
            Typical case
          </li>
          <li>
            <span className="swatch swatch-dash" />
            Deterministic
          </li>
          <li>
            <span className="swatch swatch-level" />
            Level target
          </li>
        </ul>
        <FanChart result={result} label="FI wealth by year, with the three level targets" />
        <p className="callout">
          The level lines follow the target over time: expenses grow at{" "}
          {formatPercent(view.expenses.expenseGrowth)} a year and inflation is{" "}
          {formatPercent(view.inflation)}.
        </p>
        <figcaption className="source">
          Source: {view.goals.length === 0 ? "" : "Monte Carlo on "}your goals, assumptions and
          seed.
        </figcaption>
      </figure>
      <figure className="exhibit">
        <div className="tag">Progress</div>
        <h2 className="exhibit-title">
          Share of each level's target that the typical case reaches, year by year
        </h2>
        <p className="unit">Percent of the target of that year. 100% means the level is reached.</p>
        <ProgressChart result={result} label="Percent of each level's target by year" />
        <figcaption className="source">Source: the same projection as the chart above.</figcaption>
      </figure>
    </>
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
    const { fire, expenses } = view;
    const timer = setTimeout(async () => {
      let next = view;
      if (
        parsed.l2Mult !== fire.l2Mult ||
        parsed.l3Mult !== fire.l3Mult ||
        parsed.efMonths !== fire.efMonths
      ) {
        const mine = ++sequence.current;
        try {
          next = await api<IndependenceView>("PUT", "/api/independence/settings", {
            body: {
              ...fire,
              l2Mult: parsed.l2Mult,
              l3Mult: parsed.l3Mult,
              efMonths: parsed.efMonths,
            },
          });
          if (mine !== sequence.current) return;
          onView(next);
          setError(undefined);
        } catch (failure) {
          if (mine === sequence.current) setError(messageOf(failure));
          return;
        }
      }
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
      <div className="form-grid">
        <NumberField
          label="Essential expenses a month (€)"
          value={draft.essential}
          onChange={set("essential")}
        />
        <NumberField
          label="Optional expenses a month (€)"
          value={draft.optional}
          onChange={set("optional")}
        />
        <NumberField
          label="Level 2 multiplier (months of essential)"
          value={draft.l2Mult}
          onChange={set("l2Mult")}
        />
        <NumberField
          label="Level 3 multiplier (months of optional, added to Level 2)"
          value={draft.l3Mult}
          onChange={set("l3Mult")}
        />
        <Field label="Level 1 comes from">
          <select
            value={fire.efFromGoal ?? MONTHS}
            onChange={(event) =>
              void send("/api/independence/settings", {
                ...fire,
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
          hint={fire.efFromGoal === null ? undefined : "Not used while Level 1 comes from a goal."}
        />
      </div>
      <CheckField
        label="Include the pension in the wealth"
        checked={fire.includePension}
        onChange={(includePension) =>
          void send("/api/independence/settings", { ...fire, includePension })
        }
      />
      <p className="sub">
        Expense growth is {fractionToPercent(view.expenses.expenseGrowth)}% a year. Change it on the
        Cash flow screen.
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
  const rows = ladderRows(view);
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
        Three levels of wealth, in today's euros. Values at the end of {view.asOf.slice(0, 7)}.
      </p>
      {view.note ? <p className="alert">{view.note}</p> : null}
      {view.result === null ? null : (
        <>
          {rows ? <Ladder view={view} rows={rows} /> : null}
          <LevelsTable view={view} />
        </>
      )}
      <div className="independence-controls">
        <WhatCounts view={view} onView={onView} />
        <Settings view={view} onView={onView} />
      </div>
      <Charts view={view} />
    </>
  );
}

/** Independence: the three FI levels, how far you are, when you reach them, and the settings behind them. */
export function IndependenceScreen() {
  const loaded = useLoad<IndependenceView>("/api/independence");
  return (
    <Resource loaded={loaded}>{(view) => <Screen view={view} onView={loaded.set} />}</Resource>
  );
}
