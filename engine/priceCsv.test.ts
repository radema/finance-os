import { describe, expect, it } from "vitest";
import { CsvError } from "./csv.ts";
import { latestPerMonth, parsePriceCsv } from "./priceCsv.ts";

const OPTIONS = { delimiter: "auto", decimal: "auto", dateFormat: "auto" } as const;

const LONG = `date;product;price
2026-01-31;VWCE;101,25
2026-01-31;IT0005001547;99,5
2026-02-28;VWCE;103
2026-02-28;IT0005001547;100,1
`;
const WIDE = `date;VWCE;IT0005001547
2026-01-31;101,25;99,5
2026-02-28;103;100,1
`;
const EXPECTED = [
  { product: "VWCE", date: "2026-01-31", price: 101.25 },
  { product: "IT0005001547", date: "2026-01-31", price: 99.5 },
  { product: "VWCE", date: "2026-02-28", price: 103 },
  { product: "IT0005001547", date: "2026-02-28", price: 100.1 },
];
const byKey = (rows: { product: string; date: string }[]) =>
  [...rows].sort((a, b) => (a.date + a.product).localeCompare(b.date + b.product));

describe("parsePriceCsv", () => {
  it("reads a long file", () => {
    expect(byKey(parsePriceCsv(LONG, OPTIONS))).toEqual(byKey(EXPECTED));
  });

  it("reads a wide file with two tickers, which also has three columns", () => {
    expect(byKey(parsePriceCsv(WIDE, OPTIONS))).toEqual(byKey(EXPECTED));
  });

  it("reads the same prices from a long and a wide file", () => {
    expect(byKey(parsePriceCsv(WIDE, OPTIONS))).toEqual(byKey(parsePriceCsv(LONG, OPTIONS)));
  });

  it("reads a long file with comma delimiter, quoted decimal comma and DD/MM/YYYY dates", () => {
    const text = 'Data,Prodotto,Prezzo\n31/01/2026,VWCE,"101,25"\n';
    expect(parsePriceCsv(text, OPTIONS)).toEqual([
      { product: "VWCE", date: "2026-01-31", price: 101.25 },
    ]);
  });

  it("reads a tab-delimited wide file with decimal point and a month-only date", () => {
    const text = "date\tVWCE\tSWDA\n2026-01\t101.25\t\n";
    expect(parsePriceCsv(text, { ...OPTIONS, decimal: "point" })).toEqual([
      { product: "VWCE", date: "2026-01-31", price: 101.25 },
    ]);
  });

  it("honours an explicit format over the header guess", () => {
    const text = "date,price,x\n2026-01-31,1.5,2.5\n";
    expect(parsePriceCsv(text, { ...OPTIONS, format: "wide" })).toEqual([
      { product: "price", date: "2026-01-31", price: 1.5 },
      { product: "x", date: "2026-01-31", price: 2.5 },
    ]);
  });

  it.each([
    ["a bad date", "date;product;price\nsoon;VWCE;1\n", /row 2.*date/i],
    ["a bad price", "date;product;price\n2026-01-31;VWCE;abc\n", /row 2.*price/i],
    ["a price of zero", "date;product;price\n2026-01-31;VWCE;0\n", /row 2.*price/i],
    ["an empty product", "date;product;price\n2026-01-31;;1\n", /row 2.*product/i],
    ["a header only", "date;product;price\n", /no price/i],
    ["an empty file", "", /empty/i],
  ])("refuses %s with the row named", (_name, text, message) => {
    expect(() => parsePriceCsv(text, OPTIONS)).toThrow(CsvError);
    expect(() => parsePriceCsv(text, OPTIONS)).toThrow(message);
  });
});

describe("latestPerMonth", () => {
  it("keeps the row with the latest date for each key and month", () => {
    const rows = [
      { key: "a", date: "2026-01-10", price: 1 },
      { key: "a", date: "2026-01-31", price: 2 },
      { key: "a", date: "2026-01-20", price: 3 },
      { key: "b", date: "2026-01-05", price: 4 },
      { key: "a", date: "2026-02-01", price: 5 },
    ];
    expect(latestPerMonth(rows, (row) => row.key).map((row) => row.price)).toEqual([2, 4, 5]);
  });
});
