// ============================================================
// HipCreep — minimal .xlsx writer (no dependencies)
// ------------------------------------------------------------
// Writes an Office Open XML workbook with one or more sheets of plain
// values: numbers are stored as numbers, everything else as inline strings.
// The ZIP container uses "stored" entries (no compression), which every
// spreadsheet program reads. Optional: bold header row, frozen first row,
// column widths.
// ============================================================

export type Cell = string | number | null | undefined;

export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Bold the first row and freeze it */
  header?: boolean;
  /** Column widths in characters */
  widths?: number[];
  /** Rows (0-based) written in bold */
  boldRows?: number[];
  /** PNG pictures placed on the sheet: top-left cell (0-based) and size in pixels */
  images?: SheetImage[];
}

export interface SheetImage {
  png: Uint8Array;
  col: number;
  row: number;
  widthPx: number;
  heightPx: number;
  name?: string;
}

const EMU_PER_PX = 9525;

const enc = new TextEncoder();

const xmlEsc = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters not allowed in XML 1.0
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Sheet names: max 31 chars, no []:*?/\ and unique */
function sheetNames(sheets: Sheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    let base = s.name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base, k = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 28)} (${k++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

function sheetXml(s: Sheet): string {
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  const bold = new Set(s.boldRows ?? []);
  if (s.header && s.rows.length > 1) {
    out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  }
  if (s.widths?.length) {
    out.push('<cols>' + s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>');
  }
  out.push('<sheetData>');
  s.rows.forEach((row, r) => {
    const style = (s.header && r === 0) || bold.has(r) ? ' s="1"' : '';
    const cells = row.map((v, c) => {
      const ref = `${colName(c)}${r + 1}`;
      if (v == null || v === '') return '';
      if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"${style}><v>${v}</v></c>` : '';
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    }).join('');
    out.push(`<row r="${r + 1}">${cells}</row>`);
  });
  out.push('</sheetData>');
  if (s.images?.length) out.push('<drawing r:id="rId1"/>');
  out.push('</worksheet>');
  return out.join('');
}

function drawingXml(images: SheetImage[]): string {
  const pics = images.map((im, i) => {
    const cx = Math.round(im.widthPx * EMU_PER_PX), cy = Math.round(im.heightPx * EMU_PER_PX);
    return '<xdr:oneCellAnchor>'
      + `<xdr:from><xdr:col>${im.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${im.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${cx}" cy="${cy}"/>`
      + `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${xmlEsc(im.name ?? `Picture ${i + 1}`)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
      + `<xdr:blipFill><a:blip r:embed="rId${i + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>`
      + '<xdr:clientData/></xdr:oneCellAnchor>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + pics + '</xdr:wsDr>';
}

// ---------- ZIP (stored) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // fixed DOS date/time (1 Jan 2020, 00:00) so identical content gives identical files
  const dosTime = 0, dosDate = ((2020 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true); local.setUint32(18, f.data.length, true); local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, f.data.length, true); cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

/** Build the .xlsx file as bytes */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const names = sheetNames(sheets);
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, s: string) => files.push({ name, data: enc.encode(s) });
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + sheets.map((s, i) => s.images?.length ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '').join('')
    + '</Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>');
  add('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>');
  add('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>');
  let media = 0;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  sheets.forEach((s, i) => {
    add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s));
    if (!s.images?.length) return;
    add(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + `<Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`);
    add(`xl/drawings/drawing${i + 1}.xml`, drawingXml(s.images));
    const rels = s.images.map((im, k) => {
      const name = `image${++media}.png`;
      files.push({ name: `xl/media/${name}`, data: im.png });
      return `<Relationship Id="rId${k + 1}" Type="${REL}/image" Target="../media/${name}"/>`;
    }).join('');
    add(`xl/drawings/_rels/drawing${i + 1}.xml.rels`, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`);
  });
  return zipStored(files);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
