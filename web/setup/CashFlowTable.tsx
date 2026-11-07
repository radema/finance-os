import type { CashFlowYear } from "../../engine/cashFlow.ts";
import { fromCents } from "../../engine/units.ts";
import { formatWholeEuro } from "../money.ts";

const whole = (cents: number): string => formatWholeEuro(fromCents(cents));

// The stub row is the part of the current year still to come; the label stays short so Year keeps one line.
const yearLabel = (row: CashFlowYear): string =>
  row.label === String(row.year) ? String(row.year) : `${row.year} (rest)`;

/**
 * The 10-year table: whole euros, Year sticky on the left while the table scrolls sideways.
 * Gap is the emphasised column; a negative Gap also gets a dot and the word "Short".
 */
export function CashFlowTable({ rows }: { rows: readonly CashFlowYear[] }) {
  return (
    <div className="table-scroll table-scroll-sticky">
      <table className="table table-cash-flow">
        <thead>
          <tr>
            <th>Year</th>
            <th className="num">Income</th>
            <th className="num">Expenses</th>
            <th className="num">Events</th>
            <th className="num">Pension refund</th>
            <th className="num">Capacity</th>
            <th className="num">Planned from savings</th>
            <th className="num">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <td>{yearLabel(row)}</td>
              <td className="num">{whole(row.income)}</td>
              <td className="num">{whole(row.expenses)}</td>
              <td className="num">{whole(row.events)}</td>
              <td className="num">{whole(row.refund)}</td>
              <td className="num">{whole(row.capacity)}</td>
              <td className="num">{whole(row.planned)}</td>
              <td className="num">
                {row.gap < 0 ? <span className="short">Short</span> : null}
                <strong>{whole(row.gap)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
