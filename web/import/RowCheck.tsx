import type { ReactNode } from "react";
import type {
  ImportRow,
  PreviewRow,
  RowDecision,
  RowStatus,
} from "../../engine/transactionImport.ts";
import { parseDecimal } from "../../engine/transactionImport.ts";
import { toCents } from "../../engine/units.ts";
import { SelectField } from "../setup/ui.tsx";
import { SplitControl } from "../split/SplitControl.tsx";
import type { Bucket } from "../split/splitState.ts";
import { isDuplicateFix, productPrefillHref, splitDecision } from "./importState.ts";

// Status is an icon plus a word: colour is never the only channel, and none of it is red or green.
const ICON: Record<RowStatus, string> = {
  ready: "✓",
  "already in your records": "=",
  "already in the opening position": "=",
  "needs a goal": "◐",
  "product not found": "?",
  "needs fix": "!",
};

export function StatusChip({ status }: { status: RowStatus }) {
  return (
    <span className="status-chip" data-status={status}>
      <span className="status-icon" aria-hidden="true">
        {ICON[status]}
      </span>
      {status}
    </span>
  );
}

export interface RowCheckProps {
  rows: ImportRow[];
  previews: PreviewRow[];
  decisions: Record<number, RowDecision>;
  products: readonly { id: string; name: string; regime: string }[];
  goals: readonly { id: string; name: string }[];
  bucketsOf: (productId: string) => Bucket[];
  onDecide: (rowNumber: number, decision: RowDecision | undefined) => void;
}

const COLUMNS = 10;

function CouponGoal({
  goals,
  candidates,
  value,
  onPick,
}: {
  goals: RowCheckProps["goals"];
  candidates: string[];
  value: string;
  onPick: (goalId: string) => void;
}) {
  const options = goals.filter((g) => candidates.length === 0 || candidates.includes(g.id));
  return (
    <SelectField
      label="Bucket for this coupon"
      value={value}
      onChange={onPick}
      options={[
        { value: "", label: "Choose a bucket" },
        ...(options.length > 0 ? options : goals).map((g) => ({ value: g.id, label: g.name })),
      ]}
    />
  );
}

/** The row check: one table row per file row, with the actions the status calls for. */
export function RowCheck({
  rows,
  previews,
  decisions,
  products,
  goals,
  bucketsOf,
  onDecide,
}: RowCheckProps) {
  return (
    <div className="import-scroll">
      <table className="table" data-testid="row-check">
        <thead>
          <tr>
            <th className="num">Row</th>
            <th>Date</th>
            <th>Product</th>
            <th>Type</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Commission</th>
            <th>Status</th>
            <th>Details</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const preview = previews[index];
            if (!preview) return null;
            const decision = decisions[row.rowNumber];
            const product = products.find((p) => p.id === preview.productId);
            const needsSplit =
              row.type !== "coupon" &&
              product !== undefined &&
              (preview.status === "needs a goal" || decision?.split !== undefined);
            const units = Math.abs(parseDecimal(row.qty) ?? 0);
            return (
              <RowLines
                key={row.rowNumber}
                row={row}
                preview={preview}
                showSplit={needsSplit && units > 0}
                action={
                  <>
                    {preview.status === "product not found" ? (
                      <a
                        className="btn"
                        href={productPrefillHref(row)}
                        target="_blank"
                        rel="noopener"
                      >
                        Create product
                      </a>
                    ) : null}
                    {isDuplicateFix(preview) ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          onDecide(row.rowNumber, { ...decision, confirmDuplicate: true })
                        }
                      >
                        {row.type === "coupon" ? "Confirm as real coupon" : "Confirm as real order"}
                      </button>
                    ) : null}
                    {row.type === "coupon" &&
                    (preview.status === "needs a goal" || decision?.goalId !== undefined) ? (
                      <CouponGoal
                        goals={goals}
                        candidates={preview.candidates}
                        value={decision?.goalId ?? ""}
                        onPick={(goalId) =>
                          onDecide(
                            row.rowNumber,
                            goalId === "" ? undefined : { ...decision, goalId },
                          )
                        }
                      />
                    ) : null}
                  </>
                }
                split={
                  product ? (
                    <SplitControl
                      key={`${row.rowNumber}|${row.qty}`}
                      product={product}
                      totalUnits={units}
                      buckets={bucketsOf(product.id)}
                      commissionCents={toCents(parseDecimal(row.commission) ?? 0)}
                      onConfirm={(split) =>
                        onDecide(row.rowNumber, { ...decision, ...splitDecision(split) })
                      }
                    />
                  ) : null
                }
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RowLines({
  row,
  preview,
  showSplit,
  action,
  split,
}: {
  row: ImportRow;
  preview: PreviewRow;
  showSplit: boolean;
  action: ReactNode;
  split: ReactNode;
}) {
  return (
    <>
      <tr data-testid={`row-${row.rowNumber}`}>
        <td className="num">{row.rowNumber}</td>
        <td>{row.date ?? row.dateText}</td>
        <td>
          {row.title || row.isin}
          {row.title && row.isin && row.title !== row.isin ? (
            <span className="sub"> {row.isin}</span>
          ) : null}
        </td>
        <td>{row.type}</td>
        <td className="num">{row.qty ?? "–"}</td>
        <td className="num">{row.price ?? "–"}</td>
        <td className="num">{row.commission ?? "–"}</td>
        <td>
          <StatusChip status={preview.status} />
        </td>
        <td>
          {preview.reasons.length > 0 ? (
            <ul className="reasons">
              {preview.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {preview.warnings.map((warning) => (
            <p className="sub" key={warning}>
              Note: {warning}
            </p>
          ))}
        </td>
        <td className="row-actions">{action}</td>
      </tr>
      {showSplit ? (
        <tr className="split-row-detail">
          <td colSpan={COLUMNS}>{split}</td>
        </tr>
      ) : null}
    </>
  );
}
