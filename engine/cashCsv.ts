import { parseDelimited } from "./csv.ts";
import { cashMovementInputSchema, isoDate, openingPositionInputSchema } from "./schemas.ts";
import { toCents } from "./units.ts";

export type CsvReference = { id: string; name: string; isin?: string };
export function canonicalRows(text: string, required: readonly string[]): Record<string, string>[] {
  const [header, ...rows] = parseDelimited(text, { delimiter: "," }).rows;
  if (!header || required.some((key) => !header.includes(key))) {
    throw new Error(`Required CSV columns: ${required.join(", ")}. Use decimal points and euros.`);
  }
  if (new Set(header).size !== header.length) throw new Error("Duplicate CSV columns.");
  return rows.map((cells, index) => {
    if (cells.length !== header.length)
      throw new Error(`Row ${index + 2}: column count differs from header.`);
    return Object.fromEntries(header.map((key, i) => [key, cells[i]?.trim() ?? ""]));
  });
}
export function csvNumber(value: string | undefined): number {
  if (!value || !/^-?\d+(?:\.\d+)?$/.test(value))
    throw new Error(`Invalid decimal: ${value ?? ""}.`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error("Number is too large.");
  return number;
}
export function resolveCsvReference(
  value: string | undefined,
  refs: readonly CsvReference[],
): string {
  const id = refs.find((ref) => ref.id === value);
  if (id) return id.id;
  const matches = refs.filter((ref) => ref.name === value || (ref.isin && ref.isin === value));
  if (matches.length !== 1)
    throw new Error(`Unknown or ambiguous reference: ${value ?? ""}. Use its ID.`);
  return (matches[0] as CsvReference).id;
}
export function openingCsv(
  text: string,
  cashText: string,
  goals: readonly CsvReference[],
  products: readonly CsvReference[],
) {
  const rows = text.trim() ? canonicalRows(text, ["asOf", "product", "bucket", "qty", "pmc"]) : [];
  const cash = cashText.trim() ? canonicalRows(cashText, ["asOf", "bucket", "amount"]) : [];
  const dates = new Set([...rows, ...cash].map((row) => row.asOf));
  if (dates.size !== 1) throw new Error("All opening rows must have one asOf date.");
  const positions = new Map<
    string,
    {
      productId: string;
      totalUnits: number;
      pmc: number;
      parts: { goalId: string; units: number }[];
    }
  >();
  for (const row of rows) {
    const productId = resolveCsvReference(row.product, products);
    const goalId = resolveCsvReference(row.bucket, goals);
    const units = csvNumber(row.qty);
    const pmc = csvNumber(row.pmc);
    const prior = positions.get(productId);
    if (prior) {
      prior.pmc = (prior.pmc * prior.totalUnits + pmc * units) / (prior.totalUnits + units);
      prior.totalUnits += units;
      prior.parts.push({ goalId, units });
    } else
      positions.set(productId, { productId, totalUnits: units, pmc, parts: [{ goalId, units }] });
  }
  return openingPositionInputSchema.parse({
    asOf: [...dates][0],
    positions: [...positions.values()],
    cashBalances: cash.map((row) => ({
      goalId: resolveCsvReference(row.bucket, goals),
      amountCents: toCents(csvNumber(row.amount)),
    })),
  });
}
export function cashCsv(text: string, goals: readonly CsvReference[]) {
  const rows = canonicalRows(text, [
    "sourceId",
    "date",
    "bucket",
    "type",
    "amount",
    "toBucket",
    "note",
  ]);
  const ids = new Set<string>();
  return rows.map((row) => {
    const sourceId = row.sourceId;
    if (!sourceId) throw new Error("Each cash row requires a sourceId.");
    if (sourceId && ids.has(sourceId)) throw new Error(`Duplicate sourceId: ${sourceId}.`);
    if (sourceId) ids.add(sourceId);
    if (row.type === "opening")
      throw new Error("Import opening cash together with the opening position.");
    return {
      ...cashMovementInputSchema.parse({
        date: isoDate.parse(row.date),
        goalId: resolveCsvReference(row.bucket, goals),
        type: row.type,
        amountCents: toCents(csvNumber(row.amount)),
        toGoalId: row.toBucket ? resolveCsvReference(row.toBucket, goals) : null,
        note: row.note,
      }),
      sourceId,
    };
  });
}
