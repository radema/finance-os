import { describe, expect, it } from "vitest";
import { readXlsx } from "./xlsx.ts";
import { buildXlsx } from "./xlsxBuilder.ts";

const rows = [["Titolo & Co", { n: "1.10" }, null, "<x>"], [], ["  ", { n: "0.000123" }]];
const expected = [["Titolo & Co", "1.10", null, "<x>"], [], ["  ", "0.000123"]];

describe("readXlsx", () => {
  it("reads inline strings and keeps the exact decimal text of numbers", () => {
    const sheets = readXlsx(buildXlsx([{ name: "A", rows }]));
    expect(sheets).toEqual([{ name: "A", rows: expected }]);
  });

  it("reads shared strings, and keeps blank rows so index + 1 is the row number", () => {
    const sheets = readXlsx(buildXlsx([{ name: "A", rows }], { sharedStrings: true }));
    expect(sheets[0]?.rows).toEqual(expected);
  });

  it("reads stored (uncompressed) zip entries", () => {
    const sheets = readXlsx(buildXlsx([{ name: "A", rows }], { stored: true }));
    expect(sheets[0]?.rows).toEqual(expected);
  });

  it("returns every sheet by name, in workbook order", () => {
    const sheets = readXlsx(
      buildXlsx([
        { name: "Uno & due", rows: [["a"]] },
        { name: "Tre", rows: [["b"]] },
      ]),
    );
    expect(sheets.map((s) => [s.name, s.rows])).toEqual([
      ["Uno & due", [["a"]]],
      ["Tre", [["b"]]],
    ]);
  });

  it("rejects bytes that are not a zip file", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/not an xlsx/i);
  });
});
