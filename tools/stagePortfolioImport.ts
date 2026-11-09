/** Build a reviewable replacement export in an isolated database; never opens the live database. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalRows, csvNumber, openingCsv, resolveCsvReference } from "../engine/cashCsv.ts";
import { holdingsAt } from "../engine/holdings.ts";
import { latestPerMonth, parsePriceCsv } from "../engine/priceCsv.ts";
import { productInputSchema } from "../engine/schemas.ts";
import { toScaled } from "../engine/units.ts";
import { csvReferences } from "../server/cashImport.ts";
import { loadCashState, validateLedgerHistory } from "../server/cashLedger.ts";
import { openDatabase } from "../server/db.ts";
import { exportAll, exportSchema, importAll } from "../server/exchange.ts";
import { importLedgerCsv } from "../server/ledgerImport.ts";
import { saveOpeningPosition } from "../server/openingPosition.ts";
import { toColumns as productColumns } from "../server/products.ts";
import { loadLedger } from "../server/transactions.ts";

const [sourceFile, csvDirectory, stageDirectory, outputFile] = process.argv.slice(2);
if (!sourceFile || !csvDirectory || !stageDirectory || !outputFile) {
  throw new Error(
    "Usage: node tools/stagePortfolioImport.ts SOURCE_EXPORT CSV_DIR EMPTY_STAGE_DIR OUTPUT_JSON",
  );
}
const read = (name: string) => readFileSync(resolve(csvDirectory, name), "utf8");
const source = exportSchema.parse(JSON.parse(readFileSync(sourceFile, "utf8")));
const db = await openDatabase(stageDirectory);
try {
  if ((await db.selectFrom("goal").select("id").limit(1).execute()).length)
    throw new Error("The staging database must be empty.");
  const blank = await exportAll(db);
  const merged = { ...blank, tables: { ...blank.tables, ...source.tables } };
  await importAll(db, stageDirectory, "2026-11-08", merged);
  // An old export predates the legacy metadata table. Only the retained records keep this interpretation.
  if (!source.tables.legacy_transaction) {
    const ids = await db.selectFrom("transaction").select("id").execute();
    if (ids.length) await db.insertInto("legacyTransaction").values(ids).execute();
  }
  const pensionGoals = await db
    .selectFrom("goal")
    .select("id")
    .where("name", "=", "Retirement")
    .execute();
  if (pensionGoals.length !== 1) throw new Error("Expected the preserved Retirement goal.");
  const pensionId = (pensionGoals[0] as { id: string }).id;
  const beforePension = await db
    .selectFrom("transaction")
    .selectAll()
    .where("goalId", "=", pensionId)
    .execute();
  const beforeConfiguration = {
    goals: await db.selectFrom("goal").selectAll().execute(),
    plans: await db.selectFrom("contributionPlan").selectAll().execute(),
    weights: await db.selectFrom("allocationWeight").selectAll().execute(),
  };
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom("transaction").where("goalId", "!=", pensionId).execute();
    await trx.deleteFrom("cashMovement").where("goalId", "!=", pensionId).execute();
    await trx.deleteFrom("snapshot").execute();
    for (const row of canonicalRows(read("products.csv"), ["id", "name", "regime"])) {
      const number = (key: string) => (row[key] ? csvNumber(row[key]) : 0);
      const input = productInputSchema.parse({
        ...row,
        expReturn: number("expReturn") / 100,
        volatility: number("volatility") / 100,
        ter: number("ter") / 100,
        whiteListShare: number("whiteListShare") / 100,
        couponRate: number("couponRate") / 100,
        maturity: row.maturity || null,
        zeroCommission: ["yes", "true", "1"].includes(row.zeroCommission ?? ""),
      });
      await trx
        .insertInto("product")
        .values({ id: row.id as string, ...productColumns(input) })
        .execute();
    }
    const refs = await csvReferences(trx);
    const opening = openingCsv(
      read("openings.csv"),
      read("opening-cash.csv"),
      refs.goals,
      refs.products,
    );
    if (beforePension.some((t) => t.type === "opening"))
      throw new Error(
        "Retirement contains an independent opening; supply a preservation mapping before replacement.",
      );
    await saveOpeningPosition(trx, opening, true);
    await importLedgerCsv(trx, read("transactions.csv"), read("cash-movements.csv"));
    const prices = latestPerMonth(
      parsePriceCsv(read("prices.csv"), {
        delimiter: ",",
        decimal: "point",
        dateFormat: "iso",
        format: "long",
      }),
      (p) => p.product,
    );
    for (const row of prices) {
      const productId = resolveCsvReference(row.product, refs.products);
      const columns = {
        productId,
        month: row.date.slice(0, 7),
        priceScaled: toScaled(row.price),
        priceDate: row.date,
        source: "csv" as const,
        fetchedAt: `${row.date}T00:00:00Z`,
        importBatchId: null,
      };
      await trx
        .insertInto("pricePoint")
        .values(columns)
        .onConflict((c) => c.columns(["productId", "month"]).doUpdateSet(columns))
        .execute();
    }
    const hash = createHash("sha256").update(read("manifest.json")).digest("hex");
    await trx
      .insertInto("meta")
      .values({ key: "portfolio-performance-import", value: hash })
      .onConflict((c) => c.column("key").doUpdateSet({ value: hash }))
      .execute();
    await validateLedgerHistory(trx);
  });
  const afterPension = await db
    .selectFrom("transaction")
    .selectAll()
    .where("goalId", "=", pensionId)
    .execute();
  const afterConfiguration = {
    goals: await db.selectFrom("goal").selectAll().execute(),
    plans: await db.selectFrom("contributionPlan").selectAll().execute(),
    weights: await db.selectFrom("allocationWeight").selectAll().execute(),
  };
  if (
    JSON.stringify(beforePension) !== JSON.stringify(afterPension) ||
    JSON.stringify(beforeConfiguration) !== JSON.stringify(afterConfiguration)
  )
    throw new Error("Preserved data changed.");
  const state = await loadCashState(db);
  const held = holdingsAt(await loadLedger(db), "9999-12-31");
  const report = {
    retirementUnchanged: true,
    configurationUnchanged: true,
    openingDate: "2025-12-31",
    cashBalances: Object.fromEntries(state.balances),
    positions: Object.fromEntries([...held.units].map(([g, p]) => [g, Object.fromEntries(p)])),
    inferredFunding: state.inferredFunding,
  };
  writeFileSync(outputFile, JSON.stringify(await exportAll(db), null, 2));
  writeFileSync(`${outputFile}.validation.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      outputFile,
      retirementUnchanged: true,
      configurationUnchanged: true,
      cashBuckets: state.balances.size,
      inferredFunding: state.inferredFunding.length,
    }),
  );
} finally {
  await db.destroy();
}
