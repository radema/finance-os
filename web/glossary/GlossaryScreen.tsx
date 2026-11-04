import { CRITERION_RULES } from "../../engine/optimizer.ts";
import { CapitalNote } from "../pension/CapitalNote.tsx";
import { Card } from "../setup/ui.tsx";
import { GLOSSARY } from "./terms.ts";

function MethodNotes() {
  return (
    <div className="method">
      <Card title="Time grid and the 31 December due date">
        <p>
          A goal is due on 31 December of its target year. This year is a part year: only the months
          after the valuation month are left, and they carry a part of the yearly contribution.
          Every later year up to the target year is a full year with its contribution. The target
          grows with inflation over the real time to that date.
        </p>
      </Card>
      <Card title="Taxes by regime">
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
      </Card>
      <Card title="Monte Carlo">
        <p>
          The plan runs through 1,000 simulated markets (300 for snapshots and the optimizer). Each
          run draws correlated random returns for the six asset classes. The same seed gives the
          same result. A goal succeeds when its value after tax and costs reaches the target at the
          goal date. The bad, typical and good case are the 1-in-10, the middle and the 9-in-10
          result.
        </p>
      </Card>
      <Card title="Required contribution">
        <p>
          It finds the lowest monthly amount that reaches the target, in a plain projection and in
          the simulated markets, where the probability of success must reach the required
          probability. When no amount works after 12 doublings, the goal is shown as not reachable.
        </p>
      </Card>
      <Card title="Financial independence levels">
        <p>
          Level 1 is the target of the emergency fund goal, or a number of months of essential
          spending. Level 2 is a multiple of monthly essential spending. Level 3 adds a multiple of
          monthly optional spending. All levels are in today’s euros and move with spending growth
          over inflation. Wealth counts the goals marked for independence, net of tax. The pension
          counts only when you switch it on, and never in Level 1.
        </p>
      </Card>
      <Card title="Performance formulas">
        <ul>
          <li>
            Monthly return: (value minus money put in that month) divided by the previous value,
            minus 1. The time-weighted return chains these months.
          </li>
          <li>Drawdown: the index divided by its highest point so far, minus 1.</li>
          <li>
            XIRR: the yearly rate that fits your dated cash flows and the final value. Opening
            positions count as money put in; coupons count as cash coming out.
          </li>
        </ul>
      </Card>
      <Card title="Optimizer rules">
        <p>
          It compares mixes of the products you pick, in 10-point steps, on the same simulated
          markets. It keeps the mixes that reach the required probability, then applies the
          criterion. It amplifies errors in the expected return and the volatility you enter.
        </p>
        <ul>
          {Object.values(CRITERION_RULES).map((rule) => (
            <li key={rule.name}>
              <strong>{rule.name}.</strong> {rule.text}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Kept simplifications">
        <ul>
          <li>The exit tax base is all contributions.</li>
          <li>Pension: extra deduction every year, with the refund at the marginal rate only.</li>
          <li>The pension return is taxed 20% flat.</li>
          <li>Cash pays stamp duty of 0.2% a year on the deposit account.</li>
        </ul>
      </Card>
      <Card title="Pension capital and annuity">
        <CapitalNote />
      </Card>
    </div>
  );
}

/** Setup > Glossary: the Italian terms with plain explanations, then the method notes. */
export function GlossaryScreen() {
  return (
    <>
      <div className="tag">Setup</div>
      <h1 className="title">Glossary and method</h1>
      <p className="unit">
        The Italian terms behind the numbers, in plain words. The same text opens from every term in
        the app.
      </p>
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
              {Object.entries(GLOSSARY).map(([key, term]) => (
                <tr key={key}>
                  <td>{term.it}</td>
                  <td>{term.en}</td>
                  <td>{term.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <h2 className="block-title">Method notes</h2>
      <MethodNotes />
    </>
  );
}
