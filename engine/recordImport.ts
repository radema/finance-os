// Products and goals import: read the cells of a table into typed values, then match each row to an
// existing record and check it with the Setup schemas. Pure: no I/O.
import { ASSET_CLASSES } from "./assetClasses.ts";
import type { CsvSettings } from "./csv.ts";
import { parseDate, parseNumber } from "./csv.ts";
import type { ImportTable } from "./importMapping.ts";
import { normaliseHeader } from "./importMapping.ts";
import type { Goal, GoalInput, Product, ProductInput } from "./schemas.ts";
import {
  canUseProvider,
  goalInputSchema,
  PRICE_SOURCES,
  PRIORITIES,
  productInputSchema,
  REGIMES,
} from "./schemas.ts";
import { toCents } from "./units.ts";

export type RecordKind = "products" | "goals";

// How a cell is read. Rates are percent, as the Setup form takes them; money is euros.
type Reader =
  | "text"
  | "percent"
  | "euros"
  | "integer"
  | "flag"
  | "month"
  | { oneOf: readonly string[] };

interface FieldSpec {
  /** The key of the Setup input this field fills. */
  key: string;
  label: string;
  read: Reader;
  aliases: readonly string[];
}

const PRODUCT_SPEC = {
  name: {
    key: "name",
    label: "Name",
    read: "text",
    aliases: ["name", "nome", "product", "prodotto", "titolo", "security"],
  },
  isin: { key: "isin", label: "ISIN", read: "text", aliases: ["isin"] },
  assetClass: {
    key: "assetClass",
    label: "Asset class",
    read: { oneOf: ASSET_CLASSES },
    aliases: ["assetclass", "asset class", "asset_class", "class", "classe"],
  },
  regime: {
    key: "regime",
    label: "Regime (etf, direct, govt, cash, pension)",
    read: { oneOf: REGIMES },
    aliases: ["regime"],
  },
  whiteListShare: {
    key: "whiteListShare",
    label: "White-list share (%)",
    read: "percent",
    aliases: ["whitelistshare", "white list share", "white-list share", "whitelist", "white list"],
  },
  expReturn: {
    key: "expReturn",
    label: "Expected return (%)",
    read: "percent",
    aliases: [
      "expreturn",
      "exp return",
      "exp. return",
      "expected return",
      "rendimento atteso",
      "return",
    ],
  },
  volatility: {
    key: "volatility",
    label: "Volatility (%)",
    read: "percent",
    aliases: ["volatility", "volatilita", "vol"],
  },
  ter: { key: "ter", label: "TER (%)", read: "percent", aliases: ["ter", "expense ratio"] },
  maturity: {
    key: "maturity",
    label: "Maturity (YYYY-MM)",
    read: "month",
    aliases: ["maturity", "scadenza"],
  },
  couponRate: {
    key: "couponRate",
    label: "Coupon rate (%)",
    read: "percent",
    aliases: ["couponrate", "coupon rate", "coupon", "cedola"],
  },
  zeroCommission: {
    key: "zeroCommission",
    label: "Zero commission (yes/no)",
    read: "flag",
    aliases: ["zerocommission", "zero commission", "zero commissioni"],
  },
  priceSource: {
    key: "priceSource",
    label: "Price source (provider, csv, manual)",
    read: { oneOf: PRICE_SOURCES },
    aliases: ["pricesource", "price source", "fonte prezzo"],
  },
  ticker: {
    key: "ticker",
    label: "Ticker",
    read: "text",
    aliases: ["ticker", "symbol", "simbolo"],
  },
} as const satisfies Record<string, FieldSpec>;

const GOAL_SPEC = {
  name: {
    key: "name",
    label: "Name",
    read: "text",
    aliases: ["name", "nome", "goal", "obiettivo"],
  },
  priority: {
    key: "priority",
    label: "Priority (Need, Want, Wish)",
    read: { oneOf: PRIORITIES },
    aliases: ["priority", "priorita"],
  },
  target: {
    key: "targetCents",
    label: "Target in today's euros (EUR)",
    read: "euros",
    aliases: ["target", "target amount", "importo", "importo obiettivo"],
  },
  targetYear: {
    key: "targetYear",
    label: "Target year",
    read: "integer",
    aliases: ["targetyear", "target year", "year", "anno", "anno obiettivo"],
  },
  contributionGrowth: {
    key: "contributionGrowth",
    label: "Contribution growth (%)",
    read: "percent",
    aliases: ["contributiongrowth", "contribution growth", "crescita contributi"],
  },
  minProb: {
    key: "minProb",
    label: "Minimum probability (%)",
    read: "percent",
    aliases: ["minprob", "min prob", "min probability", "probabilita minima"],
  },
  countsTowardFi: {
    key: "countsTowardFi",
    label: "Counts toward FI (yes/no)",
    read: "flag",
    aliases: ["countstowardfi", "counts toward fi", "fi"],
  },
} as const satisfies Record<string, FieldSpec>;

export type ProductField = keyof typeof PRODUCT_SPEC;
export type GoalField = keyof typeof GOAL_SPEC;
export const PRODUCT_FIELDS = Object.keys(PRODUCT_SPEC) as ProductField[];
export const GOAL_FIELDS = Object.keys(GOAL_SPEC) as GoalField[];

/** Target field to the header name of the file. A field with no entry is not mapped. */
export type RecordColumnMap = Partial<Record<ProductField | GoalField, string>>;

const specOf = (kind: RecordKind): Record<string, FieldSpec> =>
  kind === "products" ? PRODUCT_SPEC : GOAL_SPEC;

/** The fields of a kind, in form order. */
export const recordFields = (kind: RecordKind): string[] => Object.keys(specOf(kind));

/** What a field is called in the mapping form. */
export const recordFieldLabel = (kind: RecordKind, field: string): string =>
  specOf(kind)[field]?.label ?? field;

/** The first alias that names a header that no other field took. */
export function guessRecordMapping(headers: readonly string[], kind: RecordKind): RecordColumnMap {
  const names = headers.map(normaliseHeader);
  const taken = new Set<number>();
  const map: Record<string, string> = {};
  for (const [field, spec] of Object.entries(specOf(kind))) {
    for (const alias of spec.aliases) {
      const index = names.findIndex((name, i) => name === alias && !taken.has(i));
      if (index >= 0) {
        map[field] = headers[index] as string;
        taken.add(index);
        break;
      }
    }
  }
  return map;
}

/** The columns a file still needs: a product is found by ISIN or name, a goal by name. */
export function missingRecordFields(kind: RecordKind, columnMap: RecordColumnMap): string[] {
  const map = columnMap as Record<string, string | undefined>;
  if (kind === "goals") return map.name === undefined ? ["name"] : [];
  return map.name === undefined && map.isin === undefined ? ["name or isin"] : [];
}

/** One data row: the values its mapped, non-blank cells gave, and the cells that could not be read. */
export interface RecordRow {
  rowNumber: number;
  /** Keyed by the Setup input key (`targetCents`, not `target`). */
  values: Record<string, unknown>;
  errors: string[];
}

const FLAG_YES = new Set(["yes", "y", "true", "1", "si", "sì", "x"]);
const FLAG_NO = new Set(["no", "n", "false", "0"]);

type Read = { value: unknown } | { error: string };

function readCell(
  text: string,
  read: Reader,
  settings: Pick<CsvSettings, "decimal" | "dateFormat">,
): Read {
  if (read === "text") return { value: text };
  if (typeof read === "object") {
    const match = read.oneOf.find((option) => option.toLowerCase() === text.toLowerCase());
    return match === undefined
      ? { error: `must be one of ${read.oneOf.join(", ")}` }
      : { value: match };
  }
  if (read === "flag") {
    const word = text.toLowerCase();
    if (FLAG_YES.has(word)) return { value: true };
    if (FLAG_NO.has(word)) return { value: false };
    return { error: "must be yes or no" };
  }
  if (read === "month") {
    const date = parseDate(text, settings.dateFormat);
    return date === undefined ? { error: "use YYYY-MM" } : { value: date.slice(0, 7) };
  }
  const number = parseNumber(
    read === "percent" ? text.replace(/\s*%$/, "") : text,
    settings.decimal,
  );
  if (number === undefined) return { error: "not a number" };
  // The same conversions as web/forms.ts, so a value read here equals the value the form saves.
  if (read === "percent") return { value: +(number / 100).toPrecision(12) };
  return { value: read === "euros" ? toCents(number) : number };
}

/**
 * Reads the mapped cells of a table. A blank cell is left out, so the record keeps its value. A
 * cell that cannot be read is listed in `errors`, so the preview flags the row.
 *
 * @param table The header and data rows.
 * @param kind `products` or `goals`.
 * @param mapping The column map and the `decimal` and `dateFormat` settings.
 */
export function mapRecordRows(
  table: ImportTable,
  kind: RecordKind,
  mapping: { columnMap: RecordColumnMap } & Pick<CsvSettings, "decimal" | "dateFormat">,
): RecordRow[] {
  const names = table.headers.map(normaliseHeader);
  const columns = Object.entries(specOf(kind)).flatMap(([field, spec]) => {
    const header = (mapping.columnMap as Record<string, string | undefined>)[field];
    const index = header === undefined ? -1 : names.indexOf(normaliseHeader(header));
    return index < 0 ? [] : [{ field, spec, index }];
  });
  return table.rows.map(({ rowNumber, cells }) => {
    const values: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const { field, spec, index } of columns) {
      const text = (cells[index] ?? "").trim();
      if (text === "") continue;
      const read = readCell(text, spec.read, mapping);
      if ("error" in read) errors.push(`${field}: ${read.error}`);
      else values[spec.key] = read.value;
    }
    return { rowNumber, values, errors };
  });
}

export type RecordStatus = "new" | "updated" | "unchanged" | "needs fix";

/** The check of one row. `input` is the whole record to write; null when the row needs a fix. */
export interface RecordPreview<T> {
  rowNumber: number;
  status: RecordStatus;
  reason: string;
  name: string;
  /** Keys of the input that differ from the matched record; empty for a new or unchanged row. */
  changed: string[];
  /** The id of the matched record; null for a new row. */
  matchId: string | null;
  input: T | null;
}

interface Working<T> {
  id: string | null;
  input: T;
  keys: string[];
  claimedBy: number | null;
}

interface Schema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

function previewRecords<T extends object>(
  rows: readonly RecordRow[],
  existing: readonly (T & { id: string })[],
  schema: Schema<T>,
  keysOf: (record: Partial<T>) => string[],
  refuse: (input: T) => string | undefined,
): RecordPreview<T>[] {
  const working: Working<T>[] = existing.map((record) => ({
    id: record.id,
    input: record,
    keys: keysOf(record),
    claimedBy: null,
  }));
  return rows.map((row): RecordPreview<T> => {
    const fix = (reason: string, name = ""): RecordPreview<T> => ({
      rowNumber: row.rowNumber,
      status: "needs fix",
      reason,
      name: String(row.values.name ?? name),
      changed: [],
      matchId: null,
      input: null,
    });
    if (row.errors.length > 0) return fix(row.errors.join("; "));
    const wanted = keysOf(row.values as Partial<T>);
    // Keys are tried in order: an ISIN match beats a name match.
    const match = wanted
      .map((key) => working.find((record) => record.keys.includes(key)))
      .find((record) => record !== undefined);
    if (match?.claimedBy != null) {
      return fix(`Same record as row ${match.claimedBy}: it is read once.`);
    }
    const parsed = schema.safeParse({ ...match?.input, ...row.values });
    if (!parsed.success) {
      const candidate = { ...match?.input, ...row.values } as Record<string, unknown>;
      return fix(
        parsed.error.issues
          .map((issue) => {
            const key = String(issue.path[0] ?? "");
            return `${key}: ${candidate[key] === undefined ? "required" : issue.message}`;
          })
          .join("; "),
      );
    }
    const input = parsed.data;
    const refused = refuse(input);
    if (refused) return fix(refused, String((input as Record<string, unknown>).name ?? ""));
    const changed = match
      ? Object.keys(input).filter(
          (key) =>
            (input as Record<string, unknown>)[key] !==
            (match.input as Record<string, unknown>)[key],
        )
      : [];
    const name = String((input as Record<string, unknown>).name ?? "");
    if (match) {
      match.input = input;
      match.keys = keysOf(input);
      match.claimedBy = row.rowNumber;
    } else working.push({ id: null, input, keys: keysOf(input), claimedBy: row.rowNumber });
    return {
      rowNumber: row.rowNumber,
      status: !match ? "new" : changed.length > 0 ? "updated" : "unchanged",
      reason: "",
      name,
      changed,
      matchId: match?.id ?? null,
      input,
    };
  });
}

const nameKey = (record: { name?: string }): string[] =>
  record.name === undefined || record.name.trim() === "" ? [] : [`name:${record.name.trim()}`];

/**
 * Checks product rows against the existing products. A row matches by ISIN (a blank ISIN never
 * matches), then by exact name. A match is updated in its mapped columns only; no match is new. A
 * second row for a record that an earlier row already covers needs a fix.
 *
 * @param rows The rows from `mapRecordRows`.
 * @param existing The products now in the data.
 */
export function previewProductImport(
  rows: readonly RecordRow[],
  existing: readonly Product[],
): RecordPreview<ProductInput>[] {
  return previewRecords<ProductInput>(
    rows,
    existing,
    productInputSchema,
    (record) => {
      const isin = record.isin?.trim().toUpperCase() ?? "";
      return [...(isin === "" ? [] : [`isin:${isin}`]), ...nameKey(record)];
    },
    (input) =>
      input.priceSource === "provider" && !canUseProvider(input.regime)
        ? "priceSource: a BTP or a pension fund has no provider: use manual or csv"
        : undefined,
  );
}

/**
 * Checks goal rows against the existing goals. A row matches by exact name; the monthly plan, the
 * weights and the pension designation are never read.
 *
 * @param rows The rows from `mapRecordRows`.
 * @param existing The goals now in the data.
 */
export function previewGoalImport(
  rows: readonly RecordRow[],
  existing: readonly Goal[],
): RecordPreview<GoalInput>[] {
  return previewRecords<GoalInput>(rows, existing, goalInputSchema, nameKey, () => undefined);
}
