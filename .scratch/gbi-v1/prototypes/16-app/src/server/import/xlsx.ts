/* Minimal XLSX reader with no dependency: unzip with node:zlib, read the shared strings and the first sheet.
   Enough for a broker export (text and numbers). Prototype finding: a vetted reader is still the safer choice for the product (formulas, dates, odd writers). */
import { inflateRawSync } from 'node:zlib';

function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not an XLSX file (no zip directory)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), raw = buf.subarray(dataStart, dataStart + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
const decode = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
const colIndex = (ref: string): number => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

export type Cell = string | number;
export interface Sheet { name: string; rows: { n: number; cells: Cell[] }[] }

/** Rows of the first worksheet. Empty cells are ''. `n` is the sheet row number (1-based). */
export function readXlsx(buf: Buffer): Sheet {
  const files = unzip(buf), text = (f: string): string => (files.get(f) ?? Buffer.alloc(0)).toString('utf8');
  const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const first = /<sheet [^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/.exec(text('xl/workbook.xml'));
  const rel = first && new RegExp(`<Relationship [^>]*Id="${first[2]}"[^>]*>`).exec(text('xl/_rels/workbook.xml.rels'));
  const target = rel ? /Target="([^"]*)"/.exec(rel[0])?.[1] : undefined;
  const path = target ? 'xl/' + target.replace(/^\/?(xl\/)?/, '') : 'xl/worksheets/sheet1.xml';
  const xml = text(path);
  if (!xml) throw new Error('No worksheet found');
  const rows: Sheet['rows'] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const n = +(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1), cells: Cell[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cm[1])?.[1], t = /\bt="(\w+)"/.exec(cm[1])?.[1], body = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val: Cell = '';
      if (t === 's' && v != null) val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if (v != null) val = t === 'str' || t === 'e' || t === 'b' ? decode(v) : Number(v);
      cells[ref ? colIndex(ref) : cells.length] = val;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push({ n, cells });
  }
  return { name: first?.[1] ?? 'Sheet1', rows };
}
