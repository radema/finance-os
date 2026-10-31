import { inflateRawSync } from "node:zlib";

/** A cell value as text: numbers keep their exact decimal text from the file. `null` is an empty cell. */
export type Cell = string | null;

/** One worksheet. `rows[i]` is sheet row `i + 1`; `rows[i][j]` is column `j` (0 = A). Empty rows are `[]`. */
export type Sheet = { name: string; rows: Cell[][] };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const STORED = 0;
const DEFLATED = 8;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const decodeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
    return NAMED_ENTITIES[body] ?? whole;
  });

/** Reads every file of a zip into memory, keyed by entry name. Zip64 and encryption are not supported. */
function readZip(bytes: Uint8Array): Map<string, Buffer> {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = buf.length - EOCD_MIN_SIZE; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not an XLSX file: zip directory not found");

  const entryCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw new Error("Corrupt zip directory");
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLength = buf.readUInt16LE(pos + 28);
    const extraLength = buf.readUInt16LE(pos + 30);
    const commentLength = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString("utf8", pos + 46, pos + 46 + nameLength);
    pos += 46 + nameLength + extraLength + commentLength;

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new Error("Corrupt zip entry");
    const dataStart =
      localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === STORED) files.set(name, data);
    else if (method === DEFLATED) files.set(name, inflateRawSync(data));
    else throw new Error(`Unsupported zip compression method ${method}`);
  }
  return files;
}

/** The text of every `<t>` run in a fragment, joined. Phonetic runs (`<rPh>`) are left out. */
const textRuns = (xml: string): string =>
  [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((m) => decodeXml(m[1] ?? ""))
    .join("");

function readSharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) =>
    textRuns(m[1] ?? ""),
  );
}

/** Column letters to a zero-based index: A = 0, Z = 25, AA = 26. */
const columnIndex = (letters: string): number =>
  [...letters].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0) - 1;

const attribute = (attrs: string, name: string): string | undefined =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

function readCell(attrs: string, body: string, shared: string[]): Cell {
  const type = attribute(attrs, "t");
  if (type === "inlineStr") return textRuns(body);
  const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
  if (raw === undefined) return null;
  if (type === "s") return shared[Number.parseInt(raw, 10)] ?? null;
  return decodeXml(raw);
}

function readRows(xml: string, shared: string[]): Cell[][] {
  const rows: Cell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const given = attribute(rowMatch[1] ?? "", "r");
    const rowIndex = given === undefined ? nextRow : Number.parseInt(given, 10) - 1;
    nextRow = rowIndex + 1;
    const cells: Cell[] = [];
    let nextCol = 0;
    for (const c of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /^([A-Z]+)\d+$/.exec(attribute(c[1] ?? "", "r") ?? "");
      const col = ref?.[1] === undefined ? nextCol : columnIndex(ref[1]);
      nextCol = col + 1;
      while (cells.length < col) cells.push(null);
      cells[col] = readCell(c[1] ?? "", c[2] ?? "", shared);
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

/**
 * Reads an XLSX workbook with no library: zip directory, `inflateRawSync`, shared and inline strings.
 *
 * @param bytes The file content.
 * @returns Each sheet as its name and rows of cell values, in workbook order.
 */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = readZip(bytes);
  const text = (name: string): string | undefined => files.get(name)?.toString("utf8");

  const workbook = text("xl/workbook.xml");
  if (workbook === undefined) throw new Error("Not an XLSX file: xl/workbook.xml is missing");
  const targets = new Map<string, string>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(
    /<Relationship\b([^>]*?)\/?>/g,
  )) {
    const id = attribute(m[1] ?? "", "Id");
    const target = attribute(m[1] ?? "", "Target");
    if (id !== undefined && target !== undefined) targets.set(id, target);
  }
  const shared = readSharedStrings(text("xl/sharedStrings.xml"));

  return [...workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => {
    const attrs = m[1] ?? "";
    const target = targets.get(attribute(attrs, "r:id") ?? "");
    if (target === undefined) throw new Error("Corrupt XLSX: sheet without a file");
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    const sheetXml = text(path);
    if (sheetXml === undefined) throw new Error(`Corrupt XLSX: ${path} is missing`);
    return { name: decodeXml(attribute(attrs, "name") ?? ""), rows: readRows(sheetXml, shared) };
  });
}
