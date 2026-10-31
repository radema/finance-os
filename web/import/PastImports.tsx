import { useState } from "react";
import type { Loaded } from "../api.ts";
import { api, messageOf } from "../api.ts";
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
  const [error, setError] = useState<string>();
  const [undoing, setUndoing] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const undo = async (id: string) => {
    setUndoing(id);
    setError(undefined);
    setNotice(undefined);
    try {
      const done = await api<{ kept: string[] }>("POST", "/api/import/batches/undo", {
        body: { id },
      });
      if (done.kept.length > 0) {
        const kind = batches.data?.find((batch) => batch.id === id)?.kind;
        setNotice(`${done.kept.length} created ${kind} kept because they are in use.`);
      }
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setUndoing(undefined);
      batches.reload();
    }
  };

  return (
    <Card title="Past imports">
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="note" role="status">
          {notice}
        </p>
      ) : null}
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
                    <th />
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
                      <td>
                        {batch.undoneAt ? null : (
                          <button
                            className="btn"
                            type="button"
                            disabled={undoing !== undefined}
                            onClick={() => undo(batch.id)}
                          >
                            Undo
                          </button>
                        )}
                      </td>
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
