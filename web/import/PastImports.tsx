import type { Loaded } from "../api.ts";
import { Card, Resource } from "../setup/ui.tsx";
import type { BatchRow } from "./types.ts";

const KIND_LABEL: Record<BatchRow["kind"], string> = {
  transactions: "Transactions",
  prices: "Prices",
  products: "Products",
  goals: "Goals",
};

/** Every import batch of any kind, newest first. */
export function PastImports({ batches }: { batches: Loaded<BatchRow[]> }) {
  return (
    <Card title="Past imports">
      <Resource loaded={batches}>
        {(list) =>
          list.length === 0 ? (
            <p className="note">No imports yet.</p>
          ) : (
            <div className="table-scroll">
              <table className="table" data-testid="past-imports">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Source</th>
                    <th>File</th>
                    <th>Created at</th>
                    <th className="num">Read</th>
                    <th className="num">Imported</th>
                    <th className="num">Skipped</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((batch) => (
                    <tr key={batch.id}>
                      <td>{KIND_LABEL[batch.kind]}</td>
                      <td>{batch.sourceName}</td>
                      <td>{batch.fileName}</td>
                      <td>{batch.createdAt.replace("T", " ").slice(0, 16)}</td>
                      <td className="num">{batch.rowsRead}</td>
                      <td className="num">{batch.rowsImported}</td>
                      <td className="num">{batch.rowsSkipped}</td>
                      <td>{batch.undoneAt ? `Undone ${batch.undoneAt.slice(0, 10)}` : "Active"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Resource>
    </Card>
  );
}
