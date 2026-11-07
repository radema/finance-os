import { useId, useState } from "react";
import type { Goal } from "../../engine/schemas.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { checkFields } from "../formErrors.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { formatUnitPrice } from "../money.ts";
import { DateInput } from "../setup/DateInput.tsx";
import { Card, DecimalInput, ProductTag, Resource, SaveStatus } from "../setup/ui.tsx";
import { type BrokerEdits, brokerBody, brokerFields, changedBrokerRows } from "./model.ts";
import type { PriceOverviewRow } from "./types.ts";

const quantity = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 4 });

interface Holdings {
  buckets: { goalId: string; productId: string; units: number }[];
  accounts: { productId: string; units: number; pmc: number | null }[];
}

interface PositionsTableProps {
  products: PriceOverviewRow[];
  holdings: Holdings;
  goalName: (id: string) => string;
  onSaved: () => void;
}

/**
 * One row per product. The broker units and their day are typed in the rows; one Save writes every
 * row that changed. A row that the server refuses keeps its edit and shows the reason.
 */
export function PositionsTable({ products, holdings, goalName, onSaved }: PositionsTableProps) {
  const { accounts, buckets } = holdings;
  const errorPrefix = useId();
  const errorId = (productId: string) => `${errorPrefix}-${productId}`;
  const [edits, setEdits] = useState<BrokerEdits>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const changed = changedBrokerRows(products, edits);
  const edit = (productId: string, field: "units" | "date", text: string) => {
    setEdits((current) => ({ ...current, [productId]: { ...current[productId], [field]: text } }));
    setProblems(({ [productId]: _, ...rest }) => rest);
  };

  const save = async () => {
    const found: Record<string, string> = {};
    const done: string[] = [];
    for (const row of products.filter((r) => changed.includes(r.productId))) {
      const fields = brokerFields(row, edits);
      const unitsProblem = checkFields(
        { units: fields.units },
        { units: "optionalNumber" },
        {},
      ).units;
      if (unitsProblem) {
        found[row.productId] = unitsProblem;
        continue;
      }
      try {
        await api("PUT", "/api/prices/broker-units", { body: brokerBody(row.productId, fields) });
        done.push(row.productId);
      } catch (failure) {
        found[row.productId] = messageOf(failure);
      }
    }
    setProblems(found);
    setEdits((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !done.includes(id))),
    );
    if (done.length > 0) onSaved();
  };

  return (
    <>
      <div className="table-scroll">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Units</th>
              <th className="num">
                <TermPopover term="pmc">PMC</TermPopover>
              </th>
              <th>Buckets</th>
              <th className="num">Units at the broker</th>
              <th>As of</th>
            </tr>
          </thead>
          <tbody>
            {products.map((row) => {
              const account = accounts.find((a) => a.productId === row.productId);
              const parts = buckets.filter((b) => b.productId === row.productId && b.units !== 0);
              const fields = brokerFields(row, edits);
              const problem = problems[row.productId];
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
                  <td className="num">
                    <DecimalInput
                      className="inline-input"
                      aria-label={`Units at the broker, ${row.name}`}
                      {...(problem
                        ? { "aria-invalid": true, "aria-describedby": errorId(row.productId) }
                        : {})}
                      value={fields.units}
                      onChange={(text) => edit(row.productId, "units", text)}
                    />
                    {problem ? (
                      <span className="field-hint field-error" id={errorId(row.productId)}>
                        {problem}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <DateInput
                      className="inline-date"
                      aria-label={`As of, ${row.name}`}
                      value={fields.date}
                      onChange={(value) => edit(row.productId, "date", value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={changed.length === 0}
          onClick={() => void save()}
        >
          Save
        </button>
        <SaveStatus unsaved={changed.length > 0} />
      </div>
    </>
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
          {(data) => (
            <PositionsTable
              products={products}
              holdings={data}
              goalName={goalName}
              onSaved={onSaved}
            />
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
