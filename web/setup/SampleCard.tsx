import { useState } from "react";
import { api, messageOf } from "../api.ts";
import { Alert, Card } from "./ui.tsx";

/** The "Load the sample data" action (#23). The server refuses it unless the data folder is empty. */
export function SampleCard({ onLoaded }: { onLoaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = async () => {
    setBusy(true);
    try {
      await api("POST", "/api/sample-data");
      setError(undefined);
      onLoaded();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Sample data">
      <p className="note">
        The data folder is empty. Load made-up products, goals and transactions to look around. They
        are not real, and you can only load them into an empty folder.
      </p>
      <div className="actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={busy}
          onClick={() => void load()}
        >
          Load the sample data
        </button>
      </div>
      <Alert message={error} />
    </Card>
  );
}
