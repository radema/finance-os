import { useId, useState } from "react";
import { addMonths } from "../../engine/months.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { checkFields } from "../formErrors.ts";
import { num } from "../forms.ts";
import { formatPrice } from "../money.ts";
import { Alert, Card, DecimalInput, ProductTag, Resource } from "../setup/ui.tsx";
import type { Grid, GridPrice } from "./types.ts";

/** One editable cell: saves the typed price when the field loses focus and the text changed. */
function PriceInput({
  label,
  stored,
  onSave,
}: {
  label: string;
  stored: GridPrice | undefined;
  onSave: (price: number) => void;
}) {
  const initial = stored ? String(stored.price) : "";
  const [text, setText] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const errorId = useId();
  return (
    <>
      <DecimalInput
        className="inline-input"
        aria-label={label}
        {...(problem ? { "aria-invalid": true, "aria-describedby": errorId } : {})}
        value={text}
        onChange={(next) => {
          setText(next);
          setProblem(undefined);
        }}
        onBlur={() => {
          const found = checkFields({ price: text }, { price: "optionalNumber" }, {}).price;
          setProblem(found);
          const price = num(text);
          if (text !== initial && !found && Number.isFinite(price)) onSave(price);
        }}
      />
      {problem ? (
        <span className="field-hint field-error" id={errorId}>
          {problem}
        </span>
      ) : null}
    </>
  );
}

/** The month-end grid: 6 months, the clock month and later months editable, earlier ones read-only. */
export function MonthGrid({ onChanged }: { onChanged: () => void }) {
  const [through, setThrough] = useState<string>();
  const grid = useLoad<Grid>(`/api/prices/grid${through ? `?through=${through}` : ""}`);
  const [error, setError] = useState<string>();

  const save = async (productId: string, month: string, price: number) => {
    try {
      await api("PUT", "/api/prices", { body: { productId, month, price } });
      setError(undefined);
      grid.reload();
      onChanged();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <Card
      title="Month-end prices"
      note="Type the price of the current month or the next one. To correct an earlier month, import a CSV."
    >
      <Resource loaded={grid}>
        {({ currentMonth, months, rows }) =>
          rows.length === 0 ? (
            <p className="note">No products yet. Add a product in Setup first.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      {months.map((month) => (
                        <th className="num" key={month}>
                          {month}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.productId}>
                        <td>
                          {row.name} <ProductTag regime={row.regime} />
                        </td>
                        {months.map((month) => {
                          const stored = row.prices[month];
                          return (
                            <td className="num" key={month}>
                              {month === currentMonth || month === addMonths(currentMonth, 1) ? (
                                <PriceInput
                                  key={stored?.price}
                                  label={`${row.name} ${month}`}
                                  stored={stored}
                                  onSave={(price) => void save(row.productId, month, price)}
                                />
                              ) : stored ? (
                                formatPrice(stored.price)
                              ) : (
                                "–"
                              )}
                              {stored ? <div className="sub">{stored.source}</div> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  className="btn"
                  type="button"
                  onClick={() => setThrough(addMonths(months.at(-1) ?? currentMonth, 1))}
                >
                  Add next month
                </button>
              </div>
            </>
          )
        }
      </Resource>
      <Alert message={error} />
    </Card>
  );
}
