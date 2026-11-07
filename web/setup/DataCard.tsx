import { useState } from "react";
import { api, messageOf } from "../api.ts";
import { download } from "../download.ts";
import { FilePicker } from "./FilePicker.tsx";
import { Alert, Card } from "./ui.tsx";

const EXPORT_FILE = "gbi-export.json";

interface Chosen {
  name: string;
  document: unknown;
}

/** Export and import of all data as one JSON file. */
export function DataCard({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState<"exporting" | "importing">();
  const [chosen, setChosen] = useState<Chosen>();
  const [done, setDone] = useState<string>();
  const [error, setError] = useState<string>();

  const exportData = async () => {
    setBusy("exporting");
    setDone(undefined);
    try {
      const data = await api<unknown>("GET", "/api/data/export");
      download(EXPORT_FILE, JSON.stringify(data, null, 2), "application/json");
      setError(undefined);
      setDone(`Exported to ${EXPORT_FILE}.`);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(undefined);
    }
  };

  const choose = async (file: File) => {
    setDone(undefined);
    try {
      setChosen({ name: file.name, document: JSON.parse(await file.text()) });
      setError(undefined);
    } catch {
      setChosen(undefined);
      setError(`${file.name} is not a JSON file.`);
    }
  };

  const importData = async () => {
    if (!chosen) return;
    setBusy("importing");
    try {
      await api("POST", "/api/data/import", { body: chosen.document });
      setError(undefined);
      setDone(`Imported ${chosen.name}. A backup of the old data was taken first.`);
      setChosen(undefined);
      onImported();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Card
      title="Data"
      note="Export saves all your data as one JSON file. Import replaces all data with the content of such a file."
    >
      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={busy !== undefined}
          onClick={() => void exportData()}
        >
          {busy === "exporting" ? "Exporting..." : "Export data"}
        </button>
        <FilePicker
          label="Choose a file to import"
          accept=".json,application/json"
          fileName={chosen?.name}
          disabled={busy !== undefined}
          onChange={(file) => void choose(file)}
        />
      </div>
      {chosen ? (
        <div className="flag" role="alert">
          <p>
            Importing {chosen.name} replaces all your data: products, goals, transactions and
            assumptions. A backup is taken first.
          </p>
          <span className="confirm">
            <button
              className="btn"
              type="button"
              disabled={busy !== undefined}
              onClick={() => void importData()}
            >
              {busy === "importing" ? "Importing..." : "Replace all data"}
            </button>
            <button
              className="btn btn-quiet"
              type="button"
              disabled={busy !== undefined}
              onClick={() => setChosen(undefined)}
            >
              Cancel
            </button>
          </span>
        </div>
      ) : null}
      {done ? <p className="saved">{done}</p> : null}
      <Alert message={error} />
    </Card>
  );
}
