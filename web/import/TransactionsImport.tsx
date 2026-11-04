import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { GoalListView } from "../../engine/goalViews.ts";
import type { ImportMapping, TransactionField } from "../../engine/importMapping.ts";
import { FINECO_PRESET, TRANSACTION_FIELDS } from "../../engine/importMapping.ts";
import type { Product } from "../../engine/schemas.ts";
import type { RowDecision } from "../../engine/transactionImport.ts";
import { api, messageOf, useLoad } from "../api.ts";
import { TermPopover } from "../glossary/TermPopover.tsx";
import { Alert, Card, ConfirmButton, Field, SelectField, TextField } from "../setup/ui.tsx";
import type { Bucket } from "../split/splitState.ts";
import { missingFields } from "./importState.ts";
import { RowCheck } from "./RowCheck.tsx";
import type { CommitResult, FilePayload, PreviewResult, ReadResult } from "./types.ts";

const FIELD_LABEL: Record<TransactionField, ReactNode> = {
  date: "Date",
  bucket: "Bucket (optional)",
  product: (
    <>
      Product: <TermPopover term="isin">ISIN</TermPopover>, ticker or name
    </>
  ),
  type: "Type: buy, sell, A or V (empty: sign of qty)",
  qty: "Qty",
  price: "Price",
  commission: "Commission (optional)",
  note: "Note (optional)",
};
export const DELIMITERS = [
  { value: "auto", label: "Detect" },
  { value: ";", label: "Semicolon ;" },
  { value: ",", label: "Comma ," },
  { value: "\t", label: "Tab" },
];
export const DECIMALS = [
  { value: "auto", label: "Detect" },
  { value: "comma", label: "Comma 1,5" },
  { value: "point", label: "Point 1.5" },
];
export const DATES = [
  { value: "auto", label: "Detect" },
  { value: "iso", label: "YYYY-MM-DD" },
  { value: "dmy", label: "DD/MM/YYYY" },
  { value: "ym", label: "YYYY-MM" },
];
const EDITED = "__edited";

interface Weight {
  goalId: string;
  productId: string;
  weight: number;
}

export function toBase64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Operations > Import > Transactions: read a file, map the columns, check the rows, import. */
export function TransactionsImport({ onImported }: { onImported: () => void }) {
  const goals = useLoad<GoalListView>("/api/goal-list");
  const products = useLoad<Product[]>("/api/products");
  const weights = useLoad<Weight[]>("/api/allocation");

  const [pasted, setPasted] = useState("");
  const [file, setFile] = useState<FilePayload>();
  const [read, setRead] = useState<ReadResult>();
  const [mapping, setMapping] = useState<ImportMapping>();
  const [decisions, setDecisions] = useState<Record<number, RowDecision>>({});
  const [preview, setPreview] = useState<PreviewResult>();
  const [parsing, setParsing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<CommitResult>();
  const [saveName, setSaveName] = useState("");
  const [tick, setTick] = useState(0);

  const readFile = async (payload: FilePayload, delimiter = "auto") => {
    setParsing(true);
    setError(undefined);
    setResult(undefined);
    setPreview(undefined);
    setDecisions({});
    try {
      const done = await api<ReadResult>("POST", "/api/import/read", {
        body: { ...payload, delimiter },
      });
      setFile({ ...payload, sheet: done.sheet ?? undefined });
      setRead(done);
      setMapping(done.mapping);
    } catch (failure) {
      setRead(undefined);
      setMapping(undefined);
      setError(messageOf(failure));
    } finally {
      setParsing(false);
    }
  };

  const upload = async (picked: File) => {
    const name = picked.name;
    if (/\.xlsx$/i.test(name)) {
      await readFile({ fileName: name, xlsx: toBase64(await picked.arrayBuffer()) });
    } else await readFile({ fileName: name, text: await picked.text() });
  };

  const unmapped = mapping ? missingFields(mapping.columnMap) : [];
  const isPreset = mapping?.name === FINECO_PRESET.name;
  const ready = file && mapping && (isPreset || unmapped.length === 0);

  // The check runs again when the mapping, a decision or `tick` (check again, after an import) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the manual re-run trigger
  useEffect(() => {
    if (!file || !mapping || !ready) return;
    let live = true;
    setChecking(true);
    api<PreviewResult>("POST", "/api/import/preview", {
      body: { ...file, mapping, decisions },
    }).then(
      (done) => {
        if (!live) return;
        setPreview(done);
        setError(undefined);
        setChecking(false);
      },
      (failure) => {
        if (!live) return;
        setPreview(undefined);
        setError(messageOf(failure));
        setChecking(false);
      },
    );
    return () => {
      live = false;
    };
  }, [file, mapping, decisions, ready, tick]);

  const edit = (next: Partial<ImportMapping>) => {
    if (mapping) setMapping({ ...mapping, ...next, name: "" });
  };
  const setColumn = (field: TransactionField, header: string) => {
    if (!mapping) return;
    const { [field]: _dropped, ...rest } = mapping.columnMap;
    edit({ columnMap: header === "" ? rest : { ...rest, [field]: header } });
  };
  const choose = (name: string) => {
    if (!read) return;
    const picked =
      name === "Auto-guess"
        ? {
            ...read.mapping,
            name,
            columnMap: read.guess,
            decimal: "auto" as const,
            dateFormat: "auto" as const,
          }
        : read.suggestions.find((m) => m.name === name);
    if (!picked) return;
    setMapping(picked);
    setDecisions({});
  };
  const refreshSuggestions = async () => {
    if (!file) return;
    const { sheet, ...rest } = file;
    const done = await api<ReadResult>("POST", "/api/import/read", {
      body: { ...rest, sheet, delimiter: mapping?.delimiter ?? "auto" },
    });
    setRead(done);
  };
  const saveMapping = async () => {
    if (!mapping) return;
    try {
      const saved = await api<ImportMapping>("PUT", "/api/import/mappings", {
        body: { ...mapping, name: saveName.trim(), kind: "transactions" },
      });
      setMapping(saved);
      setSaveName("");
      setError(undefined);
      await refreshSuggestions();
    } catch (failure) {
      setError(messageOf(failure));
    }
  };
  const deleteMapping = async () => {
    if (!mapping) return;
    try {
      await api("DELETE", "/api/import/mappings", {
        query: { kind: "transactions", name: mapping.name },
      });
      await refreshSuggestions();
      setMapping({ ...mapping, name: "" });
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const importReady = async () => {
    if (!file || !mapping) return;
    try {
      const done = await api<CommitResult>("POST", "/api/import/commit", {
        body: { ...file, mapping, decisions },
      });
      setResult(done);
      setError(undefined);
      onImported();
      setTick((t) => t + 1);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const bucketsOf = (productId: string): Bucket[] =>
    (goals.data?.goals ?? []).map((goal) => ({
      goalId: goal.id,
      name: goal.name,
      slot: goal.slot,
      weight: weights.data?.find((w) => w.goalId === goal.id && w.productId === productId)?.weight,
    }));

  const readyCount = preview?.previews.filter((p) => p.status === "ready").length ?? 0;
  const actionCount =
    preview?.previews.filter((p) =>
      ["needs a goal", "product not found", "needs fix"].includes(p.status),
    ).length ?? 0;
  const savedNames = new Set(
    read?.suggestions.filter((m) => m.name !== FINECO_PRESET.name).map((m) => m.name),
  );
  const selected = mapping === undefined ? "" : mapping.name === "" ? EDITED : mapping.name;
  const options = [
    ...(read?.suggestions ?? []).map((m) => ({ value: m.name, label: m.name })),
    { value: "Auto-guess", label: "Auto-guess from the headers" },
    ...(selected === EDITED ? [{ value: EDITED, label: "Edited mapping (not saved)" }] : []),
  ];

  return (
    <>
      <Card
        title="Choose a file"
        note="Paste CSV text, or upload a CSV or XLSX file. The Fineco movements XLSX is recognised by its sheet and header."
      >
        <Field label="Paste the CSV text">
          <textarea
            rows={5}
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            aria-label="CSV text"
          />
        </Field>
        <div className="actions">
          <button
            className="btn"
            type="button"
            disabled={pasted.trim() === "" || parsing}
            onClick={() => void readFile({ fileName: "pasted text", text: pasted })}
          >
            Read pasted text
          </button>
        </div>
        <Field label="Or upload a file">
          <input
            type="file"
            accept=".csv,.txt,.xlsx,text/csv,text/plain"
            onChange={(event) => {
              const picked = event.target.files?.[0];
              if (picked) void upload(picked);
            }}
          />
        </Field>
        {parsing ? <p className="note">Reading the file…</p> : null}
        {!parsing && !read && !error ? (
          <p className="note">No file yet. Paste text or upload a file to start.</p>
        ) : null}
        <Alert message={error} />
      </Card>

      {read && mapping && file ? (
        <Card
          title="Columns"
          note={`${file.fileName}: ${read.rowCount} data rows${read.kind === "xlsx" ? `, sheet "${read.sheet}"` : ""}.`}
        >
          <div className="form-grid">
            {read.sheets.length > 1 ? (
              <SelectField
                label="Sheet"
                value={read.sheet ?? ""}
                onChange={(sheet) => void readFile({ ...file, sheet })}
                options={read.sheets.map((s) => ({ value: s, label: s }))}
              />
            ) : null}
            <SelectField
              label="Mapping"
              value={selected}
              onChange={(name) => choose(name)}
              options={options}
            />
            {read.kind === "csv" ? (
              <SelectField
                label="Delimiter"
                value={mapping.delimiter}
                onChange={(value) => {
                  void readFile(file, value);
                }}
                options={DELIMITERS}
              />
            ) : null}
            {isPreset ? null : (
              <>
                <SelectField
                  label="Decimal mark"
                  value={mapping.decimal}
                  onChange={(decimal) => edit({ decimal: decimal as ImportMapping["decimal"] })}
                  options={DECIMALS}
                />
                <SelectField
                  label="Date format"
                  value={mapping.dateFormat}
                  onChange={(dateFormat) =>
                    edit({ dateFormat: dateFormat as ImportMapping["dateFormat"] })
                  }
                  options={DATES}
                />
              </>
            )}
          </div>
          {isPreset ? (
            <p className="note">
              The Fineco preset reads its own columns. Pick another mapping to edit the columns.
            </p>
          ) : (
            <div className="form-grid">
              {TRANSACTION_FIELDS.map((field) => (
                <SelectField
                  key={field}
                  label={FIELD_LABEL[field]}
                  value={mapping.columnMap[field] ?? ""}
                  onChange={(header) => setColumn(field, header)}
                  options={[
                    { value: "", label: "Not mapped" },
                    ...read.headers.map((h) => ({ value: h, label: h })),
                  ]}
                />
              ))}
            </div>
          )}
          {isPreset ? null : (
            <div className="inline-form">
              <TextField label="Save this mapping as" value={saveName} onChange={setSaveName} />
              <button
                className="btn"
                type="button"
                disabled={saveName.trim() === "" || unmapped.length > 0}
                onClick={() => void saveMapping()}
              >
                Save mapping
              </button>
              {savedNames.has(mapping.name) ? (
                <ConfirmButton
                  label="Delete saved mapping"
                  confirmLabel="Delete mapping"
                  onConfirm={() => void deleteMapping()}
                />
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      {read && mapping && file ? (
        <Card title="Row check">
          {!ready ? (
            <p className="note">Map the {unmapped.join(", ")} column to see the row check.</p>
          ) : null}
          {ready && checking && !preview ? <p className="note">Checking the rows…</p> : null}
          {preview && preview.rows.length === 0 ? (
            <p className="note">The file has no data rows below the header.</p>
          ) : null}
          {preview && preview.rows.length > 0 ? (
            <>
              <p className="note" role="status" data-testid="check-summary">
                {preview.rows.length} rows read: {readyCount} ready, {actionCount} need action,{" "}
                {preview.rows.length - readyCount - actionCount} skipped.
              </p>
              <WhenLoaded
                ready={goals.data !== undefined && products.data !== undefined}
                error={goals.error ?? products.error ?? weights.error}
              >
                <RowCheck
                  rows={preview.rows}
                  previews={preview.previews}
                  decisions={decisions}
                  products={products.data ?? []}
                  goals={goals.data?.goals ?? []}
                  bucketsOf={bucketsOf}
                  onDecide={(rowNumber, decision) => {
                    const { [rowNumber]: _old, ...rest } = decisions;
                    setDecisions(decision ? { ...rest, [rowNumber]: decision } : rest);
                  }}
                />
              </WhenLoaded>
              <div className="actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={readyCount === 0 || checking}
                  onClick={() => void importReady()}
                >
                  Import ready rows ({readyCount})
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    products.reload();
                    setTick((t) => t + 1);
                  }}
                >
                  Check again
                </button>
              </div>
              {readyCount === 0 && !result ? (
                <p className="note">Nothing to import: no row is ready.</p>
              ) : null}
            </>
          ) : null}
          {result ? (
            <p className="saved" role="status" data-testid="import-result">
              {result.batchId === null
                ? `Nothing imported: no row was ready. ${result.rowsRead} read, ${result.rowsSkipped} skipped.`
                : `Imported ${result.rowsImported} of ${result.rowsRead} rows read. ${result.rowsSkipped} skipped.`}
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

/** Shows its children once the lists they need have loaded, else the load error or a wait note. */
function WhenLoaded({
  ready,
  error,
  children,
}: {
  ready: boolean;
  error: string | undefined;
  children: React.ReactNode;
}) {
  if (ready) return <>{children}</>;
  return error ? <Alert message={error} /> : <p className="note">Loading…</p>;
}
