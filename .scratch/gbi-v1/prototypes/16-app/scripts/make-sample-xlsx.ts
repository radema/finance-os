/* Writes public/fixtures/fineco-movimenti-synthetic.xlsx: a made-up file in the shape of ticket 09 (5 metadata rows, header on row 6, blank row 7, text dates DD/MM/YYYY,
   Segno A/V, a 'Stacco Cedole' coupon row). Products are the sample products; nothing comes from real/. Run: node scripts/make-sample-xlsx.ts */
import { crc32, deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { sampleState } from '../src/engine/sample.ts';
import { priceAt } from '../src/engine/core.ts';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const col = (i: number): string => String.fromCharCode(65 + i);
type Cell = string | number;
function sheetXml(rows: Cell[][]): string {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => c === '' ? '' : typeof c === 'number' ? `<c r="${col(ci)}${ri + 1}"><v>${c}</v></c>` : `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}
function zip(files: [string, string][]): Buffer {
  const parts: Buffer[] = [], dir: Buffer[] = []; let off = 0;
  for (const [name, text] of files) {
    const data = Buffer.from(text), comp = deflateRawSync(data), nb = Buffer.from(name), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const d = Buffer.alloc(46); d.writeUInt32LE(0x02014b50, 0); d.writeUInt16LE(20, 4); d.writeUInt16LE(20, 6); d.writeUInt16LE(8, 10); d.writeUInt32LE(crc, 16); d.writeUInt32LE(comp.length, 20); d.writeUInt32LE(data.length, 24); d.writeUInt16LE(nb.length, 28); d.writeUInt32LE(off, 42);
    parts.push(h, nb, comp); dir.push(d, nb); off += 30 + nb.length + comp.length;
  }
  const dirBuf = Buffer.concat(dir), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(dirBuf.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, dirBuf, end]);
}
export function xlsx(sheetName: string, rows: Cell[][]): Buffer {
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml(rows)]
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const st = sampleState(), P = (id: string) => st.products.find(p => p.id === id)!, price = (id: string, m: string) => priceAt(st, id, m)!;
  const dm = (d: string): string => d.split('-').reverse().join('/');
  const H = ['Operazione', 'Data valuta', 'Descrizione', 'Titolo', 'Isin', 'Segno', 'Quantita', 'Divisa', 'Prezzo', 'Cambio', 'Controvalore', 'Commissioni amministrato'];
  const short = (id: string): string => P(id).name.split(' (')[0].toUpperCase();
  const trade = (d: string, id: string, side: 'A' | 'V', qty: number, pr: number, fee: number): Cell[] => {
    const bond = P(id).regime === 'govt', cv = Math.round(qty * pr * (bond ? 0.01 : 1) * 100) / 100;
    return [dm(d), dm(d), 'Compravendita titoli', short(id), P(id).isin, side, qty, 'EUR', pr, 1, cv, fee];
  };
  const dup = st.ledger.find(t => t.date === '2026-10-27' && t.productId === 'p9')!;   // a trade already in the records
  const rows: Cell[][] = [
    ['Dossier n.: 000000 (synthetic)'], ['Intestazione Dossier: SAMPLE HOLDER'], [], ['RISULTATO RICERCA MOVIMENTI TITOLI (synthetic sample, made-up figures)'], [], H, [],
    trade('2026-10-05', 'p6', 'A', 8, price('p6', '2026-10'), 2.95),
    trade('2026-10-12', 'p5', 'A', 40, price('p5', '2026-10'), 0),
    trade('2026-10-15', 'p3', 'A', 180, price('p3', '2026-10'), 2.95),
    trade('2026-10-20', 'p2', 'A', 1, price('p2', '2026-10'), 2.95),
    trade('2026-10-22', 'p7', 'V', 5, price('p7', '2026-10'), 2.95),
    [dm('2026-10-28'), dm('2026-10-28'), 'Stacco Cedole', short('p10'), P('p10').isin, ' ', 10000, 'EUR', 0, 1, 218.75, 0],
    trade('2026-10-27', 'p9', 'A', dup.qty, Math.round(dup.price * 100 * 100000) / 100000, 0),
    trade('2023-12-15', 'p6', 'A', 3, 100.1, 2.95),
    [dm('2026-10-09'), dm('2026-10-09'), 'Compravendita titoli', 'ISHARES CORE MSCI WORLD', 'IE00B4L5Y983', 'A', 12, 'EUR', 98.4, 1, 1180.8, 2.95]
  ];
  mkdirSync('public/fixtures', { recursive: true });
  writeFileSync('public/fixtures/fineco-movimenti-synthetic.xlsx', xlsx('Movimenti Dossier Titoli', rows));
  console.log('wrote public/fixtures/fineco-movimenti-synthetic.xlsx,', rows.length - 7, 'data rows');
}
