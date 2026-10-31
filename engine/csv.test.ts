import { describe, expect, it } from "vitest";
import { CsvError, parseDate, parseDelimited, parseNumber } from "./csv.ts";

describe("parseDelimited", () => {
  const SETTINGS = { decimal: "auto", dateFormat: "auto" } as const;

  it.each([
    ["semicolon", "a;b;c\n1;2;3", ";"],
    ["comma", "a,b,c\n1,2,3", ","],
    ["tab", "a\tb\tc\n1\t2\t3", "\t"],
  ] as const)("detects the %s delimiter", (_name, text, delimiter) => {
    const table = parseDelimited(text, { ...SETTINGS, delimiter: "auto" });
    expect(table.delimiter).toBe(delimiter);
    expect(table.rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("uses a delimiter that is named, even when another one is more frequent", () => {
    const table = parseDelimited("a,b;c,d", { ...SETTINGS, delimiter: ";" });
    expect(table.rows).toEqual([["a,b", "c,d"]]);
  });

  it("reads quoted fields, a doubled quote, CRLF, a BOM and skips blank lines", () => {
    const text = '﻿name,price\r\n"Bond, 2030","1,5"\r\n\r\n"say ""hi""",2\r\n';
    expect(parseDelimited(text, { ...SETTINGS, delimiter: "auto" }).rows).toEqual([
      ["name", "price"],
      ["Bond, 2030", "1,5"],
      ['say "hi"', "2"],
    ]);
  });

  it("refuses an unclosed quote", () => {
    expect(() => parseDelimited('a,b\n"x,2', { ...SETTINGS, delimiter: "auto" })).toThrow(CsvError);
  });
});

describe("parseNumber", () => {
  it.each([
    ["1,5", "comma", 1.5],
    ["1.234,56", "comma", 1234.56],
    ["1.5", "point", 1.5],
    ["1,234.56", "point", 1234.56],
    ["101,25", "auto", 101.25],
    ["101.25", "auto", 101.25],
    ["1.234,56", "auto", 1234.56],
    ["1,234.56", "auto", 1234.56],
    [" 7 ", "auto", 7],
  ] as const)("reads %s with decimal %s", (text, decimal, expected) => {
    expect(parseNumber(text, decimal)).toBe(expected);
  });

  it.each(["", "abc", "1,2,3x", "12abc"])("returns undefined for %j", (text) => {
    expect(parseNumber(text, "auto")).toBeUndefined();
  });
});

describe("parseDate", () => {
  it.each([
    ["2026-03-31", "auto", "2026-03-31"],
    ["31/03/2026", "auto", "2026-03-31"],
    ["2026-03", "auto", "2026-03"],
    ["31/03/2026", "dmy", "2026-03-31"],
  ] as const)("reads %s as %s", (text, format, expected) => {
    expect(parseDate(text, format)).toBe(expected);
  });

  it.each([
    ["2026-02-30", "auto"],
    ["31/13/2026", "auto"],
    ["2026-13", "auto"],
    ["31/03/2026", "iso"],
    ["2026-03-31", "dmy"],
    ["march", "auto"],
    ["", "auto"],
  ] as const)("returns undefined for %j with format %s", (text, format) => {
    expect(parseDate(text, format)).toBeUndefined();
  });
});
