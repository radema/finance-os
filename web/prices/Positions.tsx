import { useState } from "react";
import type { Goal } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { checkFields } from "../formErrors.ts";
import { num } from "../forms.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatUnitPrice } from "../money.ts";
import { Alert, Card, DecimalInput, Field, ProductTag, Resource } from "../setup/ui.tsx";
import type { PriceOverviewRow } from "./types.ts";

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

interface Holdings {
  buckets: { goalId: string; productId: string; units: number }[];
  accounts: { productId: string; units: number; pmc: number | null }[];
}

/** The broker's unit count of a product and the day it was read. Both set, or both empty. */
function BrokerUnits({ row, onSaved }: { row: PriceOverviewRow; onSaved: () => void }) {
  const [units, setUnits] = useState(row.brokerUnits === null ? "" : String(row.brokerUnits));
  const [date, setDate] = useState(row.brokerUnitsDate ?? "");
  const [error, setError] = useState<string>();
  const [unitsError, setUnitsError] = useState<string>();

  const save = async () => {
    const empty = units.trim() === "" && date === "";
    const problems = checkFields({ units }, { units: "optionalNumber" }, {});
    setUnitsError(problems.units);
    if (problems.units) return;
    try {
      await api("PUT", "/api/prices/broker-units", {
        body: {
          productId: row.productId,
          units: empty ? null : num(units),
          date: empty ? null : date || null,
        },
      });
      setError(undefined);
      onSaved();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <div className="inline-form">
      <Field label="Units at the broker" error={unitsError}>
        {(_labelId, controlId, invalid) => (
          <DecimalInput
            id={controlId}
            {...invalid}
            value={units}
            onChange={(text) => {
              setUnits(text);
              setUnitsError(undefined);
            }}
          />
        )}
      </Field>
      <Field label="As of">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      </Field>
      <button className="btn" type="button" onClick={() => void save()}>
        Save
      </button>
      <Alert message={error} />
    </div>
  );
}

/** Positions by product: units, account PMC, buckets, and the broker units entry. */
export function Positions({
  products,
  onSaved,
}: {
  products: PriceOverviewRow[];
  onSaved: () => void;
}) {
  const holdings = useLoad<Holdings>("/api/holdings");
  const goals = useLoad<Goal[]>("/api/goals");
  const goalName = (id: string) => goals.data?.find((g) => g.id === id)?.name ?? "?";

  return (
    <Card title="Positions by product">
      {products.length === 0 ? (
        <p className="note">No products yet. Add a product in Setup first.</p>
      ) : (
        <Resource loaded={holdings}>
          {({ accounts, buckets }) => (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Units</th>
                    <th className="num">
                      <TermPopover term="pmc">PMC</TermPopover>
                    </th>
                    <th>Buckets</th>
                    <th>Broker units</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((row) => {
                    const account = accounts.find((a) => a.productId === row.productId);
                    const parts = buckets.filter(
                      (b) => b.productId === row.productId && b.units !== 0,
                    );
                    return (
                      <tr key={row.productId}>
                        <td>
                          {row.name} <ProductTag regime={row.regime} />
                        </td>
                        <td className="num">{account ? quantity.format(account.units) : "–"}</td>
                        <td className="num">
                          {account?.pmc == null ? "–" : formatUnitPrice(account.pmc)}
                        </td>
                        <td>
                          {parts.length === 0
                            ? "–"
                            : parts
                                .map((b) => `${goalName(b.goalId)}: ${quantity.format(b.units)}`)
                                .join(", ")}
                        </td>
                        <td>
                          <BrokerUnits
                            key={`${row.brokerUnits}-${row.brokerUnitsDate}`}
                            row={row}
                            onSaved={onSaved}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Resource>
      )}
      <p className="sub">
        <TermPopover term="pmc">PMC</TermPopover> is for one unit: a government bond is quoted per
        100. Broker units are checked against your buckets later (rule R9).
      </p>
    </Card>
  );
}
