import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ColumnMap, ImportMapping } from "../engine/importMapping.ts";
import { FINECO_PRESET } from "../engine/importMapping.ts";
import type { ImportRow, PreviewRow } from "../engine/transactionImport.ts";
import { openDatabase } from "./db.ts";
import { buildFinecoXlsx, SYNTHETIC_ISIN } from "./finecoFixture.ts";
import { startServer } from "./index.ts";

type ReadResult = {
  kind: "csv" | "xlsx";
  headers: string[];
  rowCount: number;
  guess: ColumnMap;
  suggestions: ImportMapping[];
  mapping: ImportMapping;
};
type Preview = { rows: ImportRow[]; previews: PreviewRow[] };
type Commit = {
  batchId: string | null;
  rowsRead: number;
  rowsImported: number;
  rowsSkipped: number;
};

const BOND = SYNTHETIC_ISIN.euroBondEtf;

describe("import API", () => {
  let dataDir: string;
  let stop: (() => Promise<void>) | undefined;
  let url: string;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "gbi-import-api-"));
    const db = await openDatabase(dataDir);
    for (const [id, isin, regime] of [
      ["p-world", SYNTHETIC_ISIN.worldEtf, "etf"],
      ["p-bond", BOND, "etf"],
      ["p-btp", SYNTHETIC_ISIN.btp, "govt"],
      ["p-gold", SYNTHETIC_ISIN.goldEtc, "etf"],
    ] as const) {
      await db
        .insertInto("product")
        .values({
          id,
          name: id,
          isin,
          assetClass: "Equity",
          regime,
          whiteListShare: 0,
          expReturn: 0.05,
          volatility: 0.15,
          ter: 0,
          maturity: null,
          couponRate: 0,
          zeroCommission: 0,
          priceSource: "manual",
          ticker: "",
          brokerUnitsScaled: null,
          brokerUnitsDate: null,
        })
        .execute();
    }
    for (const id of ["g1", "g2"]) {
      await db
        .insertInto("goal")
        .values({
          id,
          name: id,
          priority: "Need",
          targetCents: 1_000_000,
          targetYear: 2040,
          contributionGrowth: 0,
          minProb: null,
          countsTowardFi: 0,
        })
        .execute();
      await db
        .insertInto("cashMovement")
        .values({
          id: `fund-${id}`,
          date: "2020-01-01",
          goalId: id,
          type: "contribution",
          amountCents: 1_000_000_000,
          toGoalId: null,
          note: "Synthetic import funding",
          sourceId: null,
          importBatchId: null,
        })
        .execute();
    }
    for (const id of ["p-world", "p-bond", "p-btp", "p-gold"]) {
      await db
        .insertInto("allocationWeight")
        .values({ goalId: "g1", productId: id, weight: 1 })
        .execute();
    }
    await db
      .insertInto("allocationWeight")
      .values({ goalId: "g2", productId: "p-world", weight: 1 })
      .execute();
    await db.destroy();
    const server = await startServer({ dataDir, port: 0, today: "2026-03-15" });
    stop = server.close;
    url = server.url;
  });
  afterEach(async () => {
    await stop?.();
    stop = undefined;
    rmSync(dataDir, { recursive: true, force: true });
  });

  const call = async <T = unknown>(method: string, path: string, body?: unknown) => {
    const response = await fetch(`${url}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const csv = (text: string, fileName = "file.csv") => ({ fileName, text });
  const xlsx = (bytes: Buffer) => ({ fileName: "movimenti.xlsx", xlsx: bytes.toString("base64") });
  const transactions = async () => (await call<{ id: string }[]>("GET", "/api/transactions")).body;

  it("imports a semicolon file with decimal comma with the right qty, price and commission", async () => {
    const file = csv(
      `Date;ISIN;Side;Quantity;Price;Commission;Note\n15/01/2024;${BOND};buy;20;50,25;2,95;first buy\n`,
    );
    const read = (await call<ReadResult>("POST", "/api/import/read", file)).body;
    expect(read.kind).toBe("csv");
    expect(read.mapping.delimiter).toBe(";");
    const mapping = { ...read.mapping, decimal: "comma" };
    const done = await call<Commit>("POST", "/api/import/commit", {
      ...file,
      mapping,
      decisions: {},
    });
    expect(done.body).toMatchObject({ rowsRead: 1, rowsImported: 1, rowsSkipped: 0 });
    const db = await openDatabase(dataDir);
    const [row] = await db.selectFrom("transaction").selectAll().execute();
    await db.destroy();
    expect(row).toMatchObject({
      date: "2024-01-15",
      note: "first buy",
      type: "buy",
      qtyScaled: 20_000_000,
      priceScaled: 50_250_000,
      commissionCents: 295,
    });
  });

  it("reads the dates YYYY-MM-DD, DD/MM/YYYY and YYYY-MM", async () => {
    const file = csv(
      `Date,ISIN,Quantity,Price\n2024-01-15,${BOND},1,50\n16/02/2024,${BOND},1,51\n2024-03,${BOND},1,52\n`,
    );
    const read = (await call<ReadResult>("POST", "/api/import/read", file)).body;
    const preview = (
      await call<Preview>("POST", "/api/import/preview", {
        ...file,
        mapping: read.mapping,
        decisions: {},
      })
    ).body;
    expect(preview.rows.map((r) => r.date)).toEqual(["2024-01-15", "2024-02-16", "2024-03-31"]);
    expect(preview.previews.map((p) => p.status)).toEqual(["ready", "ready", "ready"]);
  });

  it("offers a saved mapping for a file with the same columns and applies it", async () => {
    const columnMap = {
      date: "Giorno",
      product: "Codice",
      qty: "Pezzi",
      price: "Valore unitario",
      commission: "Spese",
    };
    const saved = await call("PUT", "/api/import/mappings", {
      name: "My broker",
      kind: "transactions",
      columnMap,
      delimiter: ";",
      decimal: "comma",
      dateFormat: "dmy",
    });
    expect(saved.status).toBe(200);
    expect(
      (await call<ImportMapping[]>("GET", "/api/import/mappings?kind=transactions")).body,
    ).toHaveLength(1);

    // "1.234" is 1234 with the saved decimal comma; the auto setting would read 1.234.
    const file = csv(
      `Giorno;Codice;Pezzi;Valore unitario;Spese\n05/03/2024;${BOND};1.234;1,5;2,95\n`,
    );
    const read = (await call<ReadResult>("POST", "/api/import/read", file)).body;
    expect(read.guess.date).toBeUndefined();
    expect(read.suggestions.map((m) => m.name)).toEqual(["My broker"]);
    expect(read.mapping).toMatchObject({ name: "My broker", columnMap, decimal: "comma" });
    const done = await call<Commit>("POST", "/api/import/commit", {
      ...file,
      mapping: read.mapping,
      decisions: {},
    });
    expect(done.body.rowsImported).toBe(1);
    const db = await openDatabase(dataDir);
    const [row] = await db
      .selectFrom("transaction")
      .select(["qtyScaled", "commissionCents"])
      .execute();
    await db.destroy();
    expect(row).toEqual({ qtyScaled: 1_234_000_000, commissionCents: 295 });

    const other = await call<ReadResult>("POST", "/api/import/read", csv("A;B\n1;2\n"));
    expect(other.body.suggestions).toEqual([]);
  });

  it("does not offer a mapping saved for another delimiter", async () => {
    const columnMap = { date: "Giorno", product: "Codice", qty: "Pezzi", price: "Prezzo" };
    await call("PUT", "/api/import/mappings", {
      name: "semicolon broker",
      kind: "transactions",
      columnMap,
      delimiter: ";",
      decimal: "comma",
      dateFormat: "dmy",
    });
    await call("PUT", "/api/import/mappings", {
      name: "any broker",
      kind: "transactions",
      columnMap,
      delimiter: "auto",
      decimal: "comma",
      dateFormat: "dmy",
    });
    const semicolons = await call<ReadResult>(
      "POST",
      "/api/import/read",
      csv("Giorno;Codice;Pezzi;Prezzo\n1;2;3;4\n"),
    );
    expect(semicolons.body.suggestions.map((m) => m.name)).toEqual([
      "any broker",
      "semicolon broker",
    ]);
    const commas = await call<ReadResult>(
      "POST",
      "/api/import/read",
      csv("Giorno,Codice,Pezzi,Prezzo\n1,2,3,4\n"),
    );
    expect(commas.body.suggestions.map((m) => m.name)).toEqual(["any broker"]);
  });

  it("refuses to save a mapping under the preset name and deletes a saved one", async () => {
    const body = {
      name: FINECO_PRESET.name,
      kind: "transactions",
      columnMap: { date: "d" },
      delimiter: ";",
      decimal: "comma",
      dateFormat: "dmy",
    };
    expect((await call("PUT", "/api/import/mappings", body)).status).toBe(400);
    await call("PUT", "/api/import/mappings", { ...body, name: "mine" });
    await call("DELETE", "/api/import/mappings?kind=transactions&name=mine");
    expect((await call<unknown[]>("GET", "/api/import/mappings?kind=transactions")).body).toEqual(
      [],
    );
  });

  it("runs the Fineco XLSX through the same pipeline with the preset: 7 rows", async () => {
    const file = xlsx(buildFinecoXlsx());
    const read = (await call<ReadResult>("POST", "/api/import/read", file)).body;
    expect(read.kind).toBe("xlsx");
    expect(read.rowCount).toBe(7);
    expect(read.mapping.name).toBe(FINECO_PRESET.name);
    expect(read.suggestions[0]?.name).toBe(FINECO_PRESET.name);

    const preview = (
      await call<Preview>("POST", "/api/import/preview", {
        ...file,
        mapping: read.mapping,
        decisions: {},
      })
    ).body;
    expect(preview.rows).toHaveLength(7);
    const count = (status: string) => preview.previews.filter((p) => p.status === status).length;
    expect(count("ready")).toBe(4);
    expect(count("needs a goal")).toBe(3); // the world ETF trades: two buckets weigh it

    const decisions = { 8: { goalId: "g1" }, 9: { goalId: "g1" }, 13: { goalId: "g1" } };
    const done = await call<Commit>("POST", "/api/import/commit", {
      ...file,
      mapping: read.mapping,
      decisions,
    });
    expect(done.body).toMatchObject({ rowsRead: 7, rowsImported: 7, rowsSkipped: 0 });
    expect(await transactions()).toHaveLength(7);
    const again = await call<Commit>("POST", "/api/import/commit", {
      ...file,
      mapping: read.mapping,
      decisions,
    });
    expect(again.body).toMatchObject({ batchId: null, rowsImported: 0, rowsSkipped: 7 });
  });

  it("lists the batches of every kind, newest first", async () => {
    await call("POST", "/api/import/commit", {
      ...csv(`Date,ISIN,Quantity,Price\n2024-01-15,${BOND},1,50\n`),
      mapping: {
        ...FINECO_PRESET,
        name: "",
        columnMap: { date: "Date", product: "ISIN", qty: "Quantity", price: "Price" },
        delimiter: ",",
        decimal: "point",
        dateFormat: "iso",
      },
      decisions: {},
    });
    await call("POST", "/api/prices/import", {
      text: `date,product,price\n2024-01-31,${BOND},51\n`,
      fileName: "p.csv",
    });
    const list = (
      await call<{ kind: string; createdAt: string; undoneAt: string | null }[]>(
        "GET",
        "/api/import/batches",
      )
    ).body;
    expect(list.map((b) => b.kind).sort()).toEqual(["prices", "transactions"]);
    expect(list[0]?.createdAt >= (list[1]?.createdAt ?? "")).toBe(true);
    expect(list[0]).toHaveProperty("undoneAt", null);
  });

  it("undoes a batch over the API, and refuses the second undo", async () => {
    const prices = await call<{ batch?: { id: string } }>("POST", "/api/prices/import", {
      text: `date,product,price\n2024-01-31,${BOND},51\n`,
      fileName: "p.csv",
    });
    const [batch] = (await call<{ id: string }[]>("GET", "/api/import/batches")).body;
    expect(prices.status).toBe(200);
    const undone = await call<{ undoneAt: string }>("POST", "/api/import/batches/undo", {
      id: batch?.id,
    });
    expect(undone.status).toBe(200);
    expect(undone.body.undoneAt).toBeTruthy();
    const listed = (await call<{ undoneAt: string | null }[]>("GET", "/api/import/batches")).body;
    expect(listed[0]?.undoneAt).toBe(undone.body.undoneAt);
    const again = await call("POST", "/api/import/batches/undo", { id: batch?.id });
    expect(again.status).toBe(409);
  });

  it("answers 400 with a readable message for a file it cannot read", async () => {
    const bad = await call<{ error: string }>("POST", "/api/import/read", csv('a;b\n"x;2'));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/quoted field/);
    const notXlsx = await call<{ error: string }>("POST", "/api/import/read", {
      fileName: "x.xlsx",
      xlsx: Buffer.from("nope").toString("base64"),
    });
    expect(notXlsx.status).toBe(400);
  });
});
