import { type BuilderCell, buildXlsx } from "./xlsxBuilder.ts";

export const FINECO_SHEET = "Movimenti Dossier Titoli";

export const FINECO_HEADER = [
  "Operazione",
  "Data valuta",
  "Descrizione",
  "Titolo",
  "Isin",
  "Segno",
  "Quantita",
  "Divisa",
  "Prezzo",
  "Cambio",
  "Controvalore",
  "Commissioni amministrato",
];

const METADATA: BuilderCell[][] = [
  ["Movimenti Dossier Titoli"],
  ["Conto", "Dossier sintetico 000000"],
  ["Periodo dal", "01/01/2024"],
  ["Al", "31/12/2024"],
  ["Generato il", "02/01/2025"],
];

const n = (text: string): BuilderCell => ({ n: text });

/** Made-up ISINs, readable on purpose: the import tests match products by them. */
export const SYNTHETIC_ISIN = {
  worldEtf: "IE00TEST0001",
  euroBondEtf: "IE00TEST0002",
  btp: "IT00TEST0003",
  goldEtc: "JE00TEST0004",
};

const trade = (
  date: string,
  title: string,
  isin: string,
  sign: "A" | "V",
  qty: string,
  price: string,
  value: string,
  commission: string,
): BuilderCell[] => [
  date,
  date,
  "Compravendita titoli",
  title,
  isin,
  sign,
  n(qty),
  "EUR",
  n(price),
  n("1"),
  n(value),
  n(commission),
];

/** The 7 data rows of the synthetic Fineco sheet: 5 buys, 1 sell, 1 coupon. */
export const SYNTHETIC_DATA_ROWS: BuilderCell[][] = [
  trade(
    "15/01/2024",
    "ETF AZIONARIO MONDO TEST",
    SYNTHETIC_ISIN.worldEtf,
    "A",
    "10",
    "85.5",
    "855",
    "2.95",
  ),
  trade(
    "12/02/2024",
    "ETF AZIONARIO MONDO TEST",
    SYNTHETIC_ISIN.worldEtf,
    "A",
    "5",
    "88.2",
    "441",
    "2.95",
  ),
  trade(
    "11/03/2024",
    "ETF OBBLIGAZIONARIO EURO TEST",
    SYNTHETIC_ISIN.euroBondEtf,
    "A",
    "20",
    "50.25",
    "1005",
    "2.95",
  ),
  trade("15/04/2024", "BTP TEST 2030 3%", SYNTHETIC_ISIN.btp, "A", "3000", "98.5", "2955", "2.95"),
  trade("13/05/2024", "ETC ORO TEST", SYNTHETIC_ISIN.goldEtc, "A", "4", "190.75", "763", "2.95"),
  trade(
    "17/06/2024",
    "ETF AZIONARIO MONDO TEST",
    SYNTHETIC_ISIN.worldEtf,
    "V",
    "8",
    "90.1",
    "720.8",
    "2.95",
  ),
  [
    "01/07/2024",
    "01/07/2024",
    "Stacco Cedole",
    "BTP TEST 2030 3%",
    SYNTHETIC_ISIN.btp,
    " ",
    n("3000"),
    "EUR",
    null,
    n("1"),
    n("40.5"),
    null,
  ],
];

/**
 * Builds a Fineco "Movimenti Dossier Titoli" XLSX in the shape of the real export:
 * 5 metadata rows, the header on row 6, a blank row 7, data from row 8.
 *
 * @param dataRows Data rows, in the column order of `FINECO_HEADER`.
 * @returns The file bytes.
 */
export const buildFinecoXlsx = (dataRows: BuilderCell[][] = SYNTHETIC_DATA_ROWS): Buffer =>
  buildXlsx([{ name: FINECO_SHEET, rows: [...METADATA, FINECO_HEADER, [], ...dataRows] }], {
    sharedStrings: true,
  });

/** A Fineco XLSX with `count` data rows (the synthetic rows, repeated), for speed tests. */
export const buildLargeFinecoXlsx = (count: number): Buffer =>
  buildFinecoXlsx(
    Array.from(
      { length: count },
      (_, i) => SYNTHETIC_DATA_ROWS[i % SYNTHETIC_DATA_ROWS.length] ?? [],
    ),
  );
