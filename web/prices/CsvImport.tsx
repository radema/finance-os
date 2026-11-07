import { useState } from "react";
import { api, messageOf } from "../api.ts";
import { TemplateButton } from "../import/TemplateButton.tsx";
import { FilePicker, PASTED_TEXT, shownFileName } from "../setup/FilePicker.tsx";
import { Alert, Card, Field, SelectField } from "../setup/ui.tsx";
import type { ImportResult } from "./types.ts";

const DELIMITERS = [
  { value: "auto", label: "Detect" },
  { value: ";", label: "Semicolon ;" },
  { value: ",", label: "Comma ," },
  { value: "\t", label: "Tab" },
];
const DECIMALS = [
  { value: "auto", label: "Detect" },
  { value: "comma", label: "Comma 1,5" },
  { value: "point", label: "Point 1.5" },
];
const DATES = [
  { value: "auto", label: "Detect" },
  { value: "iso", label: "YYYY-MM-DD" },
  { value: "dmy", label: "DD/MM/YYYY" },
  { value: "ym", label: "YYYY-MM" },
];
const LAYOUTS = [
  { value: "auto", label: "Detect" },
  { value: "long", label: "Long: date, product, price" },
  { value: "wide", label: "Wide: date, one column per product" },
];

/** Pasted or uploaded CSV prices: long or wide, with the parser settings. */
export function CsvImport({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string>(PASTED_TEXT);
  const [delimiter, setDelimiter] = useState("auto");
  const [decimal, setDecimal] = useState("auto");
  const [dateFormat, setDateFormat] = useState("auto");
  const [format, setFormat] = useState("auto");
  const [result, setResult] = useState<ImportResult>();
  const [error, setError] = useState<string>();

  const run = async () => {
    try {
      const done = await api<ImportResult>("POST", "/api/prices/import", {
        body: { text, fileName, delimiter, decimal, dateFormat, format },
      });
      setResult(done);
      setError(undefined);
      onImported();
    } catch (failure) {
      setResult(undefined);
      setError(messageOf(failure));
    }
  };

  return (
    <Card
      title="Import prices from CSV"
      note="Long: date, product (ISIN, ticker or name), price. Wide: a date column and one column per product. A CSV price replaces the price of that month."
    >
      <Field label="Paste the CSV text">
        <textarea
          rows={6}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setFileName(PASTED_TEXT);
          }}
        />
      </Field>
      <FilePicker
        label="Or upload a file"
        accept=".csv,.txt,text/csv,text/plain"
        fileName={shownFileName(fileName)}
        onChange={async (file) => {
          setText(await file.text());
          setFileName(file.name);
        }}
      />
      <div className="form-grid">
        <SelectField
          label="Delimiter"
          value={delimiter}
          onChange={setDelimiter}
          options={DELIMITERS}
        />
        <SelectField
          label="Decimal mark"
          value={decimal}
          onChange={setDecimal}
          options={DECIMALS}
        />
        <SelectField
          label="Date format"
          value={dateFormat}
          onChange={setDateFormat}
          options={DATES}
        />
        <SelectField label="Layout" value={format} onChange={setFormat} options={LAYOUTS} />
      </div>
      <div className="actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={text.trim() === ""}
          onClick={() => void run()}
        >
          Import prices
        </button>
        <TemplateButton kind="prices" />
      </div>
      <Alert message={error} />
      {result ? (
        <p className="note" role="status" data-testid="import-result">
          Imported {result.rowsImported} of {result.rowsRead} rows.
          {result.unknownProducts.length > 0
            ? ` Skipped unknown products: ${result.unknownProducts.join(", ")}.`
            : ""}
        </p>
      ) : null}
    </Card>
  );
}
