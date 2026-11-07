import { useEffect, useState } from "react";
import type { RecordColumnMap, RecordKind, RecordPreview } from "../../engine/recordImport.ts";
import {
  guessRecordMapping,
  missingRecordFields,
  recordFieldLabel,
  recordFields,
} from "../../engine/recordImport.ts";
import { api, messageOf } from "../api.ts";
import { FilePicker } from "../setup/FilePicker.tsx";
import { Alert, Card, Field, SelectField } from "../setup/ui.tsx";
import { TemplateButton } from "./TemplateButton.tsx";
import { DATES, DECIMALS, DELIMITERS, toBase64 } from "./TransactionsImport.tsx";
import type { FilePayload, ReadResult } from "./types.ts";

interface Mapping {
  columnMap: RecordColumnMap;
  delimiter: string;
  decimal: string;
  dateFormat: string;
}
interface Commit {
  batchId: string | null;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
  created: number;
  updated: number;
}

/** Operations > Import > Products or Goals: read a file, map the columns, check the rows, import. */
export function RecordImport({ kind, onImported }: { kind: RecordKind; onImported: () => void }) {
  const [pasted, setPasted] = useState("");
  const [pickedName, setPickedName] = useState<string>();
  const [file, setFile] = useState<FilePayload>();
  const [read, setRead] = useState<ReadResult>();
  const [mapping, setMapping] = useState<Mapping>();
  const [previews, setPreviews] = useState<RecordPreview<unknown>[]>();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<Commit>();
  const [tick, setTick] = useState(0);

  const readFile = async (payload: FilePayload, delimiter = "auto") => {
    setParsing(true);
    setError(undefined);
    setResult(undefined);
    setPreviews(undefined);
    try {
      const done = await api<ReadResult>("POST", "/api/import/read", {
        body: { ...payload, delimiter },
      });
      setFile({ ...payload, sheet: done.sheet ?? undefined });
      setRead(done);
      setMapping({
        columnMap: guessRecordMapping(done.headers, kind),
        delimiter: done.mapping.delimiter,
        decimal: "auto",
        dateFormat: "auto",
      });
    } catch (failure) {
      setRead(undefined);
      setMapping(undefined);
      setError(messageOf(failure));
    } finally {
      setParsing(false);
    }
  };

  const upload = async (picked: File) => {
    if (/\.xlsx$/i.test(picked.name)) {
      await readFile({ fileName: picked.name, xlsx: toBase64(await picked.arrayBuffer()) });
    } else await readFile({ fileName: picked.name, text: await picked.text() });
  };

  const missing = mapping ? missingRecordFields(kind, mapping.columnMap) : [];

  // The check runs again when the mapping changes, or when `tick` (after an import) changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the manual re-run trigger
  useEffect(() => {
    if (!file || !mapping || missing.length > 0) return;
    let live = true;
    api<{ previews: RecordPreview<unknown>[] }>("POST", "/api/import/records/preview", {
      body: { ...file, kind, mapping },
    }).then(
      (done) => {
        if (!live) return;
        setPreviews(done.previews);
        setError(undefined);
      },
      (failure) => {
        if (!live) return;
        setPreviews(undefined);
        setError(messageOf(failure));
      },
    );
    return () => {
      live = false;
    };
  }, [file, mapping, kind, missing.length, tick]);

  const edit = (next: Partial<Mapping>) => mapping && setMapping({ ...mapping, ...next });
  const setColumn = (field: string, header: string) => {
    if (!mapping) return;
    const { [field as keyof RecordColumnMap]: _dropped, ...rest } = mapping.columnMap;
    edit({ columnMap: header === "" ? rest : { ...rest, [field]: header } });
  };

  const importRows = async () => {
    if (!file || !mapping) return;
    try {
      setResult(
        await api<Commit>("POST", "/api/import/records/commit", {
          body: { ...file, kind, mapping },
        }),
      );
      setError(undefined);
      onImported();
      setTick((t) => t + 1);
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  const count = (status: string) => previews?.filter((p) => p.status === status).length ?? 0;
  const writable = count("new") + count("updated");

  return (
    <>
      <Card
        title={`Choose a file of ${kind}`}
        note={
          kind === "products"
            ? "A row updates the product with the same ISIN, else the same name; no match creates one. Rates are percent. Only the mapped columns change, and a blank cell keeps the value."
            : "A row updates the goal with the same name; no match creates one. Rates are percent, the target is in euros. The monthly plan and the weights are not imported."
        }
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
          <TemplateButton kind={kind} />
        </div>
        <FilePicker
          label="Or upload a file"
          accept=".csv,.txt,.xlsx,text/csv,text/plain"
          fileName={pickedName}
          onChange={(picked) => {
            setPickedName(picked.name);
            void upload(picked);
          }}
        />
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
            {read.kind === "csv" ? (
              <SelectField
                label="Delimiter"
                value={mapping.delimiter}
                onChange={(value) => void readFile(file, value)}
                options={DELIMITERS}
              />
            ) : null}
            <SelectField
              label="Decimal mark"
              value={mapping.decimal}
              onChange={(decimal) => edit({ decimal })}
              options={DECIMALS}
            />
            <SelectField
              label="Date format"
              value={mapping.dateFormat}
              onChange={(dateFormat) => edit({ dateFormat })}
              options={DATES}
            />
          </div>
          <div className="form-grid">
            {recordFields(kind).map((field) => (
              <SelectField
                key={field}
                label={recordFieldLabel(kind, field)}
                value={(mapping.columnMap as Record<string, string | undefined>)[field] ?? ""}
                onChange={(header) => setColumn(field, header)}
                options={[
                  { value: "", label: "Not mapped" },
                  ...read.headers.map((h) => ({ value: h, label: h })),
                ]}
              />
            ))}
          </div>
        </Card>
      ) : null}

      {read && mapping && file ? (
        <Card title="Row check">
          {missing.length > 0 ? (
            <p className="note">Map the {missing.join(", ")} column to see the row check.</p>
          ) : null}
          {previews && previews.length === 0 ? (
            <p className="note">The file has no data rows below the header.</p>
          ) : null}
          {previews && previews.length > 0 ? (
            <>
              <p className="note" role="status" data-testid="check-summary">
                {previews.length} rows read: {count("new")} new, {count("updated")} updated,{" "}
                {count("unchanged")} unchanged, {count("needs fix")} need a fix.
              </p>
              <div className="import-scroll">
                <table className="table" data-testid="row-check">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previews.map((p) => (
                      <tr key={p.rowNumber}>
                        <td className="num">{p.rowNumber}</td>
                        <td>{p.name}</td>
                        <td>{p.status}</td>
                        <td>
                          {p.reason ||
                            (p.changed.length > 0 ? `Changes ${p.changed.join(", ")}` : "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  disabled={writable === 0}
                  onClick={() => void importRows()}
                >
                  Import {writable} rows
                </button>
              </div>
              {writable === 0 && !result ? <p className="note">Nothing to import.</p> : null}
            </>
          ) : null}
          {result ? (
            <p className="saved" role="status" data-testid="import-result">
              {result.batchId === null
                ? `Nothing imported. ${result.rowsRead} read, ${result.rowsSkipped} skipped.`
                : `Imported ${result.rowsImported} of ${result.rowsRead} rows read: ${result.created} new, ${result.updated} updated. ${result.rowsSkipped} skipped.`}
            </p>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
