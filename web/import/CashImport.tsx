import { useState } from "react";
import { api, messageOf } from "../api.ts";
import { download } from "../download.ts";
import { FilePicker } from "../FilePicker.tsx";
import { Alert, Card, Field } from "../setup/ui.tsx";

interface Preview {
  rows: number;
  errors: string[];
}
export function CashImport({
  kind,
  onImported,
}: {
  kind: "openings" | "cash" | "ledger";
  onImported: () => void;
}) {
  const [text, setText] = useState("");
  const [cashText, setCashText] = useState("");
  const [fileName, setFileName] = useState<string>();
  const [cashFile, setCashFile] = useState<string>();
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const opening = kind === "openings";
  const ledger = kind === "ledger";
  const run = async (action: "preview" | "commit") => {
    if (
      action === "commit" &&
      opening &&
      !window.confirm("Replace the current opening portfolio and opening cash with these CSV rows?")
    )
      return;
    try {
      const result = await api<Preview>("POST", `/api/import/${kind}/${action}`, {
        body: opening || ledger ? { text, cashText } : { text },
      });
      setError(undefined);
      if (action === "preview") setPreview(result);
      else {
        setDone(true);
        setPreview(undefined);
        onImported();
      }
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const change = (value: string, cash = false) => {
    if (cash) setCashText(value);
    else setText(value);
    setPreview(undefined);
    setDone(false);
  };
  return (
    <Card
      title={
        opening
          ? "Import opening portfolio"
          : ledger
            ? "Import trades and cash"
            : "Import cash movements"
      }
      note={
        ledger
          ? "Use unique source IDs. Amount is optional gross euros, with commission separate; sell quantities are negative. Government bond prices are per 100. Preview both files before importing."
          : "Use the canonical CSV template, then preview before importing."
      }
    >
      <Field
        label={opening ? "Opening positions CSV" : ledger ? "Trades CSV" : "Cash movements CSV"}
      >
        <textarea
          rows={6}
          value={text}
          onChange={(e) => {
            change(e.target.value);
            setFileName(undefined);
          }}
        />
      </Field>
      <FilePicker
        label="Upload CSV"
        accept=".csv,.txt,text/csv,text/plain"
        fileName={fileName}
        onChange={async (file) => {
          change(await file.text());
          setFileName(file.name);
        }}
      />
      <button
        className="btn"
        type="button"
        onClick={() =>
          download(
            `gbi-${kind}-template.csv`,
            opening
              ? "asOf,product,bucket,qty,pmc\n"
              : ledger
                ? "sourceId,date,bucket,product,type,qty,price,commission,amount,note\n"
                : "sourceId,date,bucket,type,amount,toBucket,note\n",
            "text/csv",
          )
        }
      >
        Download CSV template
      </button>
      {opening || ledger ? (
        <>
          <Field label={opening ? "Opening cash CSV (optional)" : "Cash movements CSV"}>
            <textarea
              rows={4}
              value={cashText}
              onChange={(e) => {
                change(e.target.value, true);
                setCashFile(undefined);
              }}
            />
          </Field>
          <FilePicker
            label={opening ? "Upload opening cash CSV" : "Upload cash movements CSV"}
            accept=".csv,.txt,text/csv,text/plain"
            fileName={cashFile}
            onChange={async (file) => {
              change(await file.text(), true);
              setCashFile(file.name);
            }}
          />
          <button
            className="btn"
            type="button"
            onClick={() =>
              download(
                opening ? "gbi-opening-cash-template.csv" : "gbi-cash-template.csv",
                opening
                  ? "asOf,bucket,amount\n"
                  : "sourceId,date,bucket,type,amount,toBucket,note\n",
                "text/csv",
              )
            }
          >
            Download cash CSV template
          </button>
        </>
      ) : null}
      <div className="actions">
        <button
          className="btn"
          type="button"
          disabled={!text.trim() && (!(opening || ledger) || !cashText.trim())}
          onClick={() => void run("preview")}
        >
          Preview
        </button>
        <button
          className="btn btn-primary"
          type="button"
          disabled={!preview || preview.errors.length > 0}
          onClick={() => void run("commit")}
        >
          Import
        </button>
      </div>
      <Alert message={error} />
      {preview ? (
        <div role="status">
          <p>{preview.rows} rows found.</p>
          {preview.errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}
      {done ? <p role="status">Import completed.</p> : null}
    </Card>
  );
}
