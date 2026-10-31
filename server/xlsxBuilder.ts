import { crc32, deflateRawSync } from "node:zlib";

/** A cell to write: text, a number given as its exact decimal text, or empty. */
export type BuilderCell = string | { n: string } | null;

export type BuilderSheet = { name: string; rows: BuilderCell[][] };

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const columnLetters = (index: number): string => {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
};

function sheetXml(rows: BuilderCell[][], shared: string[] | undefined): string {
  const body = rows
    .map((cells, r) => {
      const xml = cells
        .map((cell, c) => {
          const ref = `${columnLetters(c)}${r + 1}`;
          if (cell === null) return "";
          if (typeof cell !== "string") return `<c r="${ref}"><v>${cell.n}</v></c>`;
          if (shared === undefined) {
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
          }
          shared.push(cell);
          return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
        })
        .join("");
      return xml === "" ? "" : `<row r="${r + 1}">${xml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Writes a zip. Entries are deflated unless `stored` is set. */
function zip(files: [name: string, content: string][], stored: boolean): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const raw = Buffer.from(content, "utf8");
    const data = stored ? raw : deflateRawSync(raw);
    const nameBytes = Buffer.from(name, "utf8");
    const method = stored ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}

/**
 * Builds a small XLSX file in memory, for tests and synthetic fixtures.
 *
 * @param sheets Sheets to write, in order.
 * @param options `sharedStrings` writes text through a shared string table instead of inline
 *   strings; `stored` skips compression.
 * @returns The file bytes.
 */
export function buildXlsx(
  sheets: BuilderSheet[],
  options: { sharedStrings?: boolean; stored?: boolean } = {},
): Buffer {
  const shared = options.sharedStrings ? [] : undefined;
  const sheetFiles = sheets.map((sheet, i): [string, string] => [
    `xl/worksheets/sheet${i + 1}.xml`,
    sheetXml(sheet.rows, shared),
  ]);
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook ${ns} xmlns:r="${relNs}"><sheets>${sheets
    .map((s, i) => `<sheet name="${escapeXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("")}</sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${relNs}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("")}</Relationships>`;
  const files: [string, string][] = [
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", rels],
    ...sheetFiles,
  ];
  if (shared !== undefined) {
    const items = shared
      .map((s) => `<si><t xml:space="preserve">${escapeXml(s)}</t></si>`)
      .join("");
    files.push([
      "xl/sharedStrings.xml",
      `<?xml version="1.0" encoding="UTF-8"?><sst ${ns}>${items}</sst>`,
    ]);
  }
  return zip(files, options.stored === true);
}
