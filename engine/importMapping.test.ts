import { describe, expect, it } from "vitest";
import type { ImportMapping, ImportTable } from "./importMapping.ts";
import { FINECO_PRESET, guessMapping, mapRows, suggestMappings } from "./importMapping.ts";
import { parseDecimal } from "./transactionImport.ts";

const GOALS = [
  { id: "g1", name: "House" },
  { id: "g2", name: "Retirement" },
];

const settings = { decimal: "comma", dateFormat: "auto" } as const;

const table = (headers: string[], ...rows: string[][]): ImportTable => ({
  headers,
  rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
});

const saved = (name: string, columnMap: ImportMapping["columnMap"]): ImportMapping => ({
  name,
  kind: "transactions",
  columnMap,
  delimiter: ";",
  decimal: "comma",
  dateFormat: "dmy",
});

describe("guessMapping", () => {
  it("matches English field names", () => {
    expect(
      guessMapping(
        ["Date", "ISIN", "Side", "Quantity", "Price", "Commission", "Notes"],
        "transactions",
      ),
    ).toEqual({
      date: "Date",
      product: "ISIN",
      type: "Side",
      qty: "Quantity",
      price: "Price",
      commission: "Commission",
      note: "Notes",
    });
  });

  it("matches the Fineco column names, with or without accents", () => {
    const headers = [
      "Operazione",
      "Data valuta",
      "Descrizione",
      "Isin",
      "Segno",
      "Quantità",
      "Prezzo",
      "Commissioni amministrato",
    ];
    expect(guessMapping(headers, "transactions")).toEqual({
      date: "Operazione",
      product: "Isin",
      type: "Segno",
      qty: "Quantità",
      price: "Prezzo",
      commission: "Commissioni amministrato",
    });
  });

  it("uses a header once and leaves unknown headers unmapped", () => {
    expect(guessMapping(["when", "what", "price"], "transactions")).toEqual({ price: "price" });
  });

  it("guesses nothing for a kind that has no target fields yet", () => {
    expect(guessMapping(["Date", "Price"], "products")).toEqual({});
  });
});

describe("mapRows", () => {
  const map = { date: "d", product: "p", qty: "q", price: "pr", commission: "c" };

  it("reads a semicolon file with decimal comma into exact decimal text", () => {
    const rows = mapRows(
      table(["d", "p", "q", "pr", "c"], ["15/01/2024", "IE00TEST0001", "10", "85,50", "2,95"]),
      { columnMap: map, ...settings },
      GOALS,
    );
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      date: "2024-01-15",
      isin: "IE00TEST0001",
      ticker: "IE00TEST0001",
      name: "IE00TEST0001",
      type: "buy",
      qty: "10",
      price: "85.5",
      commission: "2.95",
      currency: "EUR",
    });
  });

  it("reads the three date formats", () => {
    const dates = ["2024-01-15", "15/01/2024", "2024-01"];
    const rows = mapRows(
      table(["d", "p", "q", "pr", "c"], ...dates.map((d) => [d, "X", "1", "1", ""])),
      { columnMap: map, decimal: "point", dateFormat: "auto" },
      GOALS,
    );
    expect(rows.map((r) => r.date)).toEqual(["2024-01-15", "2024-01-15", "2024-01-31"]);
  });

  it("writes fractions as plain decimal text with no trailing dot", () => {
    const [row] = mapRows(
      table(["d", "p", "q", "pr"], ["2024-01-15", "X", "0,9999999", "0,0000001"]),
      { columnMap: map, ...settings },
      GOALS,
    );
    expect(row).toMatchObject({ qty: "1", price: "0" });
    expect(parseDecimal(row?.qty ?? null)).toBe(1);
    expect(parseDecimal(row?.price ?? null)).toBe(0);
  });

  it("keeps an unreadable date as null with its text", () => {
    const [row] = mapRows(
      table(["d", "p", "q", "pr"], ["31/02/2024", "X", "1", "1"]),
      { columnMap: map, ...settings },
      GOALS,
    );
    expect(row).toMatchObject({ date: null, dateText: "31/02/2024" });
  });

  it("keeps the text of a number it cannot read, so the preview flags it", () => {
    const [row] = mapRows(
      table(["d", "p", "q", "pr", "c"], ["2024-01-15", "X", "1", "1", "abc"]),
      { columnMap: map, ...settings },
      GOALS,
    );
    expect(row?.commission).toBe("abc");
  });

  it("takes buy and sell from words, letters A and V, or the sign of qty", () => {
    const withType = mapRows(
      table(
        ["d", "p", "t", "q", "pr"],
        ...["Buy", "SELL", " a ", "v", "x"].map((t) => ["2024-01-15", "X", t, "5", "1"]),
      ),
      { columnMap: { ...map, type: "t" }, decimal: "point", dateFormat: "auto" },
      GOALS,
    );
    expect(withType.map((r) => r.type)).toEqual(["buy", "sell", "buy", "sell", "unknown"]);
    const signed = mapRows(
      table(["d", "p", "q", "pr"], ["2024-01-15", "X", "5", "1"], ["2024-01-15", "X", "-5", "1"]),
      { columnMap: map, decimal: "point", dateFormat: "auto" },
      GOALS,
    );
    expect(signed.map((r) => r.type)).toEqual(["buy", "sell"]);
  });

  it("resolves the bucket by goal id or name: undefined when empty, null when unknown", () => {
    const rows = mapRows(
      table(
        ["d", "p", "q", "pr", "b"],
        ...["g1", "retirement", "", "nope"].map((b) => ["2024-01-15", "X", "1", "1", b]),
      ),
      { columnMap: { ...map, bucket: "b" }, decimal: "point", dateFormat: "auto" },
      GOALS,
    );
    expect(rows.map((r) => r.bucket)).toEqual(["g1", "g2", undefined, null]);
  });

  it("carries the note", () => {
    const [row] = mapRows(
      table(["d", "p", "q", "pr", "n"], ["2024-01-15", "X", "1", "1", "first"]),
      { columnMap: { ...map, note: "n" }, decimal: "point", dateFormat: "auto" },
      GOALS,
    );
    expect(row?.note).toBe("first");
  });
});

describe("suggestMappings", () => {
  const headers = ["Data", "Titolo", "Qty", "Prezzo"];
  const mine = saved("broker A", { date: "Data", product: "Titolo", qty: "Qty", price: "Prezzo" });

  it("offers a saved mapping whose columns all exist in the file", () => {
    const other = saved("broker B", { date: "Datum", product: "Titolo" });
    expect(suggestMappings(headers, [mine, other], "transactions")).toEqual([mine]);
  });

  it("ignores other kinds and mappings with no columns", () => {
    const prices = { ...mine, kind: "prices" as const };
    expect(suggestMappings(headers, [prices, saved("empty", {})], "transactions")).toEqual([]);
  });

  it("ranks the built-in preset first, then the mapping with more columns, then the name", () => {
    const small = saved("a small", { date: "Data", qty: "Qty" });
    const zeta = saved("zeta", { date: "Data", product: "Titolo" });
    const preset = { ...FINECO_PRESET, columnMap: { date: "Data" } };
    const names = suggestMappings(headers, [zeta, small, mine, preset], "transactions").map(
      (m) => m.name,
    );
    expect(names).toEqual([FINECO_PRESET.name, "broker A", "a small", "zeta"]);
  });

  it("matches header names without case or accents", () => {
    const m = saved("accents", { qty: "Quantità" });
    expect(suggestMappings(["quantita"], [m], "transactions")).toEqual([m]);
  });
});
