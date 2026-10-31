import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFinecoXlsx,
  buildLargeFinecoXlsx,
  FINECO_HEADER,
  FINECO_SHEET,
  SYNTHETIC_DATA_ROWS,
  SYNTHETIC_ISIN,
} from "./finecoFixture.ts";
import { parseFinecoMovimenti } from "./finecoMovimenti.ts";
import { readXlsx } from "./xlsx.ts";
import { type BuilderCell, buildXlsx } from "./xlsxBuilder.ts";

const parseSheet = (bytes: Uint8Array) => {
  const sheet = readXlsx(bytes).find((s) => s.name === FINECO_SHEET);
  if (sheet === undefined) throw new Error("sheet missing");
  return parseFinecoMovimenti(sheet.rows);
};

const countBy = (rows: { type: string }[]) => ({
  buy: rows.filter((r) => r.type === "buy").length,
  sell: rows.filter((r) => r.type === "sell").length,
  coupon: rows.filter((r) => r.type === "coupon").length,
});

describe("parseFinecoMovimenti on the committed synthetic file", () => {
  const bytes = readFileSync(
    join(import.meta.dirname, "../fixtures/fineco-movimenti-synthetic.xlsx"),
  );
  const parsed = parseSheet(bytes);

  it("returns 7 rows: 5 buys, 1 sell, 1 coupon, none lost to the metadata block", () => {
    expect(parsed).toHaveLength(7);
    expect(countBy(parsed)).toEqual({ buy: 5, sell: 1, coupon: 1 });
    expect(parsed.map((r) => r.rowNumber)).toEqual([8, 9, 10, 11, 12, 13, 14]);
  });

  it("reads the first buy with ISO date, exact decimals and the Isin as identity", () => {
    expect(parsed[0]).toEqual({
      rowNumber: 8,
      date: "2024-01-15",
      dateText: "15/01/2024",
      isin: SYNTHETIC_ISIN.worldEtf,
      title: "ETF AZIONARIO MONDO TEST",
      type: "buy",
      qty: "10",
      price: "85.5",
      commission: "2.95",
      controvalore: "855",
      currency: "EUR",
      fx: "1",
      description: "Compravendita titoli",
    });
  });

  it("trims Segno so the coupon has no side, and keeps the BTP price per 100", () => {
    expect(parsed[3]).toMatchObject({
      type: "buy",
      isin: SYNTHETIC_ISIN.btp,
      qty: "3000",
      price: "98.5",
    });
    expect(parsed[6]).toMatchObject({
      type: "coupon",
      date: "2024-07-01",
      price: null,
      commission: null,
    });
    expect(parsed[5]).toMatchObject({ type: "sell", date: "2024-06-17" });
  });
});

describe("parseFinecoMovimenti layout and bad cells", () => {
  it("parses the same rows when the header is on another row and the columns are reordered", () => {
    const order = [4, 2, 0, 1, 3, 5, 6, 7, 8, 9, 10, 11].reverse();
    const permute = (cells: BuilderCell[]) => order.map((i) => cells[i] ?? null);
    const header = permute(FINECO_HEADER);
    const rows: BuilderCell[][] = [
      ["Intestazione"],
      [],
      ["altro", "testo"],
      header,
      [],
      [],
      ...SYNTHETIC_DATA_ROWS.map(permute),
    ];
    const variant = parseFinecoMovimenti(
      readXlsx(buildXlsx([{ name: FINECO_SHEET, rows }]))[0]?.rows ?? [],
    );
    const standard = parseSheet(buildFinecoXlsx());
    expect(variant.map(({ rowNumber: _r, ...rest }) => rest)).toEqual(
      standard.map(({ rowNumber: _r, ...rest }) => rest),
    );
    expect(variant[0]?.rowNumber).toBe(7);
  });

  it("keeps a row with an unreadable date: date is null and the raw text stays", () => {
    const bad: BuilderCell[] = [...(SYNTHETIC_DATA_ROWS[0] ?? [])];
    bad[0] = "31/02/2024";
    const parsed = parseSheet(
      buildFinecoXlsx([bad, ["oggi", ...bad.slice(1)], [null, ...bad.slice(1)]]),
    );
    expect(parsed).toHaveLength(3);
    expect(parsed.map((r) => [r.date, r.dateText])).toEqual([
      [null, "31/02/2024"],
      [null, "oggi"],
      [null, ""],
    ]);
  });

  it("keeps a row with an unknown Descrizione as type unknown, and one with an odd Segno", () => {
    const unknown: BuilderCell[] = [...(SYNTHETIC_DATA_ROWS[0] ?? [])];
    unknown[2] = "Rimborso capitale";
    const oddSign: BuilderCell[] = [...(SYNTHETIC_DATA_ROWS[0] ?? [])];
    oddSign[5] = "X";
    const parsed = parseSheet(buildFinecoXlsx([unknown, oddSign]));
    expect(parsed.map((r) => [r.type, r.description])).toEqual([
      ["unknown", "Rimborso capitale"],
      ["unknown", "Compravendita titoli"],
    ]);
  });

  it("returns empty cells as null and does not crash on missing columns of a row", () => {
    const parsed = parseSheet(buildFinecoXlsx([["15/01/2024", null, "Compravendita titoli"]]));
    expect(parsed[0]).toMatchObject({
      type: "unknown",
      isin: "",
      qty: null,
      price: null,
      currency: "",
    });
  });

  it("fails with a clear error when no header row is found", () => {
    expect(() => parseFinecoMovimenti([["a", "b"], ["c"]])).toThrow(/Operazione/);
  });

  it("parses a 200-row file", () => {
    expect(parseSheet(buildLargeFinecoXlsx(200))).toHaveLength(200);
  });
});

// Local only: real/ is never committed. Assert counts, never print or copy values.
const REAL_SAMPLE = join(import.meta.dirname, "../real/fineco-movimenti-sample.xlsx");
describe.skipIf(!existsSync(REAL_SAMPLE))("parseFinecoMovimenti on the real sample", () => {
  it("returns 7 rows: 6 trades (5 A, 1 V) and 1 coupon", () => {
    const parsed = parseSheet(readFileSync(REAL_SAMPLE));
    expect(parsed).toHaveLength(7);
    expect(countBy(parsed)).toEqual({ buy: 5, sell: 1, coupon: 1 });
  });
});
