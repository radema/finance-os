import { type ReactNode, useEffect } from "react";
import { CRITERION_RULES } from "../../engine/optimizer.ts";
import { hashParams } from "../hashQuery.ts";
import { GLOSSARY_ROUTE } from "../nav.ts";
import { CapitalNote } from "../pension/CapitalNote.tsx";
import { SetupTabs } from "../setup/SetupTabs.tsx";
import { Card } from "../setup/ui.tsx";
import { GLOSSARY } from "./terms.ts";

interface MethodNote {
  title: string;
  body: ReactNode;
}

/** The method notes in reading order. The contents line and the cards both come from this list. */
const METHOD_NOTES: readonly MethodNote[] = [
  {
    title: "Time grid and the 31 December due date",
    body: (
      <p>
        A goal is due on 31 December of its target year. This year is a part year: only the months
        after the valuation month are left, and they carry a part of the yearly contribution. Every
        later year up to the target year is a full year with its contribution. The target grows with
        inflation over the real time to that date.
      </p>
    ),
  },
  {
    title: "Taxes by regime",
    body: (
      <ul>
        <li>
          ETF: 26% minus 13.5 points times the white-list share. Losses cannot offset ETF gains.
        </li>
        <li>
          Single stocks and bonds: 26%, and 12.5% on government bonds. Losses and the zainetto
          offset these gains.
        </li>
        <li>Cash: interest is taxed each year at 26%.</li>
        <li>Pension fund: the return is taxed each year, and the exit tax applies at payout.</li>
        <li>Stamp duty (bollo): 0.2% a year on the value, except on pension funds.</li>
      </ul>
    ),
  },
  {
    title: "Monte Carlo",
    body: (
      <p>
        The plan runs through 1,000 simulated markets (300 for snapshots and the optimizer, 200 when
        the optimizer looks for the lowest monthly amount). Each run draws correlated random returns
        for the six asset classes. The same seed gives the same result. A goal succeeds when its
        value after tax and costs reaches the target at the goal date. The bad, typical and good
        case are the 1-in-10, the middle and the 9-in-10 result.
      </p>
    ),
  },
  {
    title: "Required contribution",
    body: (
      <p>
        It finds the lowest monthly amount that reaches the target, in a plain projection and in the
        simulated markets, where the probability of success must reach the required probability.
        When no amount works after 12 doublings, the goal is shown as not reachable.
      </p>
    ),
  },
  {
    title: "Financial independence levels",
    body: (
      <p>
        Financial security is the target of the emergency fund goal, or a number of months of
        essential spending. Barista FIRE and Lean FIRE are multiples of monthly essential spending,
        200 and 300 by default. Financial Freedom adds a multiple of monthly optional spending to
        Lean FIRE. All levels are in today’s euros and move with spending growth over inflation.
        Wealth counts the goals marked for independence, net of tax. The pension counts only when
        you switch it on, and never for Financial security.
      </p>
    ),
  },
  {
    title: "Performance formulas",
    body: (
      <ul>
        <li>
          Monthly return: (value minus money put in that month) divided by the previous value, minus
          1. The time-weighted return chains these months.
        </li>
        <li>Drawdown: the index divided by its highest point so far, minus 1.</li>
        <li>
          XIRR: the yearly rate that fits your dated cash flows and the final value. Opening
          positions count as money put in; coupons count as cash coming out.
        </li>
      </ul>
    ),
  },
  {
    title: "Optimizer rules",
    body: (
      <>
        <p>
          It compares mixes of the products you pick, in 10-point steps for up to 4 products and
          20-point steps for 5 or 6, on the same simulated markets. It keeps the mixes that reach
          the required probability, then applies the criterion. It amplifies errors in the expected
          return and the volatility you enter.
        </p>
        <ul>
          {Object.values(CRITERION_RULES).map((rule) => (
            <li key={rule.name}>
              <strong>{rule.name}.</strong> {rule.text}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    title: "Kept simplifications",
    body: (
      <ul>
        <li>The exit tax base is all contributions.</li>
        <li>Pension: extra deduction every year, with the refund at the marginal rate only.</li>
        <li>The pension return is taxed 20% flat.</li>
        <li>Cash pays stamp duty of 0.2% a year on the deposit account.</li>
      </ul>
    ),
  },
  {
    title: "Pension capital and annuity",
    body: <CapitalNote />,
  },
];

const noteId = (title: string): string =>
  `method-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

/** The terms A to Z by English term, ignoring case. */
const TERMS = Object.entries(GLOSSARY).sort(([, a], [, b]) =>
  a.en.localeCompare(b.en, "en", { sensitivity: "base" }),
);

/** Scroll to the element the hash names with `?at=` and focus it; runs on arrival and on a new link. */
function useAnchorFocus(): void {
  useEffect(() => {
    const land = () => {
      const id = hashParams().get("at");
      const target = id === null ? null : document.getElementById(id);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "start" });
    };
    land();
    window.addEventListener("hashchange", land);
    return () => window.removeEventListener("hashchange", land);
  }, []);
}

function MethodContents() {
  return (
    <nav className="method-contents" aria-label="Contents">
      <span className="method-contents-label">Method notes</span>
      <ul>
        {METHOD_NOTES.map((note) => (
          <li key={note.title}>
            {/* The hash holds the route, so the target goes in `at`. */}
            <a href={`#/${GLOSSARY_ROUTE}?at=${noteId(note.title)}`}>{note.title}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function MethodNotes() {
  return (
    <div className="method">
      {METHOD_NOTES.map((note) => (
        <div key={note.title} id={noteId(note.title)} className="method-note" tabIndex={-1}>
          <Card level={3} title={note.title}>
            {note.body}
          </Card>
        </div>
      ))}
    </div>
  );
}

/** Setup > Glossary: the Italian terms with plain explanations, then the method notes. */
export function GlossaryScreen() {
  useAnchorFocus();
  return (
    <div className="setup-column">
      <div className="tag">Setup</div>
      <h1 className="title">Glossary</h1>
      <SetupTabs route={GLOSSARY_ROUTE} />
      <p className="unit">
        The Italian terms behind the numbers, in plain words. The same text opens from every term in
        the app.
      </p>
      <MethodContents />
      <Card title="Glossary">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Italian term</th>
                <th>English term</th>
                <th>Explanation</th>
              </tr>
            </thead>
            <tbody>
              {TERMS.map(([key, term]) => (
                <tr key={key} id={`term-${key}`} className="glossary-term" tabIndex={-1}>
                  <td>{term.it}</td>
                  <td>{term.en}</td>
                  <td>{term.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <h2 className="method-title">Method notes</h2>
      <MethodNotes />
    </div>
  );
}
