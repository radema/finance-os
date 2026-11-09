import { describe, expect, it } from "vitest";
import { cashCsv, openingCsv } from "./cashCsv.ts";

const goals = [
  { id: "g", name: "Government, long-term" },
  { id: "h", name: "Home" },
];
const products = [{ id: "p", name: "Fund", isin: "XX123" }];

describe("cash CSV parsing", () => {
  it("aggregates opening quantities and PMC, including quoted names and cash only", () => {
    const parsed = openingCsv(
      'asOf,product,bucket,qty,pmc\n2026-01-01,XX123,"Government, long-term",2,10\n2026-01-01,p,Home,3,20',
      'asOf,bucket,amount\n2026-01-01,"Government, long-term",12.34\n2026-01-01,Home,5.01',
      goals,
      products,
    );
    expect(parsed.positions).toEqual([
      {
        productId: "p",
        totalUnits: 5,
        pmc: 16,
        parts: [
          { goalId: "g", units: 2 },
          { goalId: "h", units: 3 },
        ],
      },
    ]);
    expect(parsed.cashBalances).toEqual([
      { goalId: "g", amountCents: 1234 },
      { goalId: "h", amountCents: 501 },
    ]);
    expect(openingCsv("", "asOf,bucket,amount\n2026-01-01,g,1", goals, products).positions).toEqual(
      [],
    );
  });

  it("rejects duplicate bucket rows, invalid values, dates and ambiguous references", () => {
    const cases = [
      () =>
        openingCsv(
          "asOf,product,bucket,qty,pmc\n2026-01-01,p,g,1,2\n2026-01-01,p,g,1,2",
          "",
          goals,
          products,
        ),
      () => openingCsv("asOf,product,bucket,qty,pmc\n2026-01-01,p,g,0,2", "", goals, products),
      () => openingCsv("asOf,product,bucket,qty,pmc\nnot-a-date,p,g,1,2", "", goals, products),
      () =>
        openingCsv("asOf,product,bucket,qty,pmc\n2026-01-01,p,missing,1,2", "", goals, products),
      () => openingCsv("", "asOf,bucket,amount\n2026-01-01,g,1\n2026-01-01,g,2", goals, products),
    ];
    for (const run of cases) expect(run).toThrow();
  });

  it("validates cash source ids, decimal/date/reference fields and rejects same-bucket transfers", () => {
    const parse = (text: string) => cashCsv(text, goals);
    const header = "date,bucket,type,amount,toBucket,note,sourceId\n";
    expect(parse(header + "2026-01-01,g,contribution,10,,,one")[0]).toMatchObject({
      amountCents: 1000,
      sourceId: "one",
    });
    for (const rows of [
      "2026-01-01,g,contribution,1,,,x\n2026-01-01,h,contribution,1,,,x",
      "2026-01-01,g,contribution,1.2.3,,,x",
      "not-a-date,g,contribution,1,,,x",
      "2026-01-01,missing,contribution,1,,,x",
      "2026-01-01,g,transfer,1,g,,x",
      "2026-01-01,g,contribution,1,,,",
    ])
      expect(() => parse(header + rows)).toThrow();
  });
});
