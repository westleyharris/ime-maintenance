// ── Mapping workbook parser ───────────────────────────────────────────────────
//
// Reads an IME predictive-maintenance mapping workbook (IME_UT_<plant> <line>_
// Mapping.xlsx) and pulls out, per asset row, the tag and the photos embedded
// beside it.
//
// SheetJS is already a dependency but CANNOT read embedded images, so the file is
// opened as a plain zip instead. Layout, verified against Alsip L1:
//
//   one sheet per section · header row located by the literal "Sub System"
//   tag in that column (F) · photos anchored in "Component Picture" (G)
//
// The photo→asset link is the anchor's 0-based row index in xl/drawings/drawingN
// .xml, NOT anything in the cell itself. Sheet and drawing numbers do not line up
// (sheet2 → drawing1), so every hop follows the rels chain.

import { unzipSync } from 'fflate';

const NS = {
  main:    'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  xdr:     'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  a:       'http://schemas.openxmlformats.org/drawingml/2006/main',
  r:       'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pkgRels: 'http://schemas.openxmlformats.org/package/2006/relationships',
};

/** Sheets that never hold asset rows. */
const SKIP_SHEETS = new Set(['cover', 'template', 'tables']);

// Header wording is not stable across plants, so the tag column is searched by
// priority: the first label present wins. Compared on a key with every
// non-alphanumeric stripped, so "Sub System", "Sub-System" and "SUBSYSTEM" are
// all one thing. Spanish variants included — some plants keep Spanish workbooks.
const TAG_HEADERS = [
  'subsystem', 'subsistema', 'component', 'componente', 'machine', 'maquina',
  'equipment', 'equipo', 'assettag', 'equipmenttag', 'tag', 'activo',
];
const PICTURE_HEADERS = [
  'componentpicture', 'picture', 'photo', 'image', 'foto', 'imagen', 'fotografia',
];

export interface WorkbookImage {
  /** Zip entry, e.g. xl/media/image6.jpeg — also the identity used for dedupe. */
  path: string;
  bytes: Uint8Array;
  mime: string;
}

export interface WorkbookRow {
  /** 0-based sheet row, the key the drawing anchors use. */
  rowIndex: number;
  tag: string;
  area: string | null;
  functionalLocation: string | null;
  accessibility: string | null;
  notes: string | null;
  /** Candidate photos in anchor order. Usually the machine and its nameplate. */
  images: WorkbookImage[];
}

export interface WorkbookSheet {
  name: string;
  rows: WorkbookRow[];
  /** Photos anchored in the picture column but on no asset row — diagnostics only. */
  strayImageCount: number;
}

export interface ParsedWorkbook {
  location: string | null;
  line: string | null;
  machine: string | null;
  sheets: WorkbookSheet[];
  /** Sheets that yielded no asset table. */
  skipped: string[];
  /** Per-sheet notes on how (or whether) the table was located. */
  diagnostics: string[];
}

export class WorkbookParseError extends Error {}

// ── XML helpers ───────────────────────────────────────────────────────────────

function parseXml(bytes: Uint8Array, what: string): Document {
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new WorkbookParseError(`${what} is not valid XML — the file may be corrupt.`);
  }
  return doc;
}

/** rId → target, from any .rels part. */
function relMap(doc: Document): Map<string, string> {
  const out = new Map<string, string>();
  for (const el of Array.from(doc.getElementsByTagNameNS(NS.pkgRels, 'Relationship'))) {
    const id = el.getAttribute('Id');
    const target = el.getAttribute('Target');
    if (id && target) out.set(id, target);
  }
  return out;
}

/** Resolve a rels target (often "../media/x.png") against the part that declared it. */
function resolvePath(fromPart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const segs = fromPart.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') segs.pop();
    else if (seg !== '.') segs.push(seg);
  }
  return segs.join('/');
}

/** "BC12" → { col: 54, row: 11 }, both 0-based. */
function refToColRow(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) - 1 };
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
};

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Header comparison key: lowercase, alphanumerics only. */
const headerKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Most frequent value, used to pick the picture column from image anchors. */
function modal(nums: number[]): number | null {
  if (!nums.length) return null;
  const count = new Map<number, number>();
  for (const n of nums) count.set(n, (count.get(n) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

// ── Parse ─────────────────────────────────────────────────────────────────────

export function parseMappingWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      // Everything except xl/media is small; media is the bulk but is the payload.
      filter: (f) =>
        f.name === 'xl/workbook.xml' ||
        f.name === 'xl/sharedStrings.xml' ||
        f.name === 'xl/_rels/workbook.xml.rels' ||
        f.name.startsWith('xl/worksheets/') ||
        f.name.startsWith('xl/drawings/') ||
        f.name.startsWith('xl/media/'),
    });
  } catch {
    throw new WorkbookParseError('Could not open the file as a .xlsx workbook.');
  }

  const need = (p: string): Uint8Array => {
    const f = files[p];
    if (!f) throw new WorkbookParseError(`Workbook is missing ${p}.`);
    return f;
  };

  // Shared strings — cells with t="s" index into this.
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const sst = parseXml(files['xl/sharedStrings.xml'], 'sharedStrings.xml');
    for (const si of Array.from(sst.getElementsByTagNameNS(NS.main, 'si'))) {
      // Runs (<r><t>) must be concatenated, otherwise rich-text cells truncate.
      shared.push(Array.from(si.getElementsByTagNameNS(NS.main, 't')).map(t => t.textContent ?? '').join(''));
    }
  }

  const wbRels = relMap(parseXml(need('xl/_rels/workbook.xml.rels'), 'workbook.xml.rels'));
  const wb = parseXml(need('xl/workbook.xml'), 'workbook.xml');

  const sheets: WorkbookSheet[] = [];
  const skipped: string[] = [];
  const diagnostics: string[] = [];
  let location: string | null = null;
  let line: string | null = null;
  let machine: string | null = null;

  for (const el of Array.from(wb.getElementsByTagNameNS(NS.main, 'sheet'))) {
    const name = el.getAttribute('name') ?? '';
    const rid = el.getAttributeNS(NS.r, 'id');
    if (!rid) continue;
    const target = wbRels.get(rid);
    if (!target) continue;
    const sheetPath = resolvePath('xl/workbook.xml', target);
    const sheetFile = files[sheetPath];
    if (!sheetFile) continue;

    const isSkippable = SKIP_SHEETS.has(name.trim().toLowerCase());

    // ── cells ────────────────────────────────────────────────────────────────
    const doc = parseXml(sheetFile, `${name} (${sheetPath})`);
    const cells = new Map<string, string>();
    for (const c of Array.from(doc.getElementsByTagNameNS(NS.main, 'c'))) {
      const ref = c.getAttribute('r');
      if (!ref) continue;
      const t = c.getAttribute('t');
      let val: string;
      if (t === 'inlineStr') {
        val = Array.from(c.getElementsByTagNameNS(NS.main, 't')).map(x => x.textContent ?? '').join('');
      } else {
        const v = c.getElementsByTagNameNS(NS.main, 'v')[0];
        if (!v) continue;
        val = t === 's' ? (shared[parseInt(v.textContent ?? '0', 10)] ?? '') : (v.textContent ?? '');
      }
      const s = norm(val);
      if (s) cells.set(ref, s);
    }

    // Header block on the first asset sheet describes the whole workbook.
    if (location == null && cells.get('G5')) location = cells.get('G5') ?? null;
    if (line == null && cells.get('G9')) line = cells.get('G9') ?? null;
    if (machine == null && cells.get('G10')) machine = cells.get('G10') ?? null;

    if (isSkippable) { skipped.push(name); continue; }

    // ── every image anchored anywhere on the sheet ───────────────────────────
    // Collected BEFORE the header is resolved: when the header wording is
    // unfamiliar, the anchors themselves reveal where the picture column is.
    const anchors: { col: number; row: number; image: WorkbookImage }[] = [];
    const sheetRelsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
    const sheetRels = files[sheetRelsPath] ? relMap(parseXml(files[sheetRelsPath], sheetRelsPath)) : new Map();
    const drawingTarget = Array.from(sheetRels.values()).find(t => t.includes('drawings/drawing'));
    if (drawingTarget) {
      const drawingPath = resolvePath(sheetPath, drawingTarget);
      const drawingFile = files[drawingPath];
      if (drawingFile) {
        const dRelsPath = drawingPath.replace(/([^/]+)$/, '_rels/$1.rels');
        const dRels = files[dRelsPath] ? relMap(parseXml(files[dRelsPath], dRelsPath)) : new Map();
        const dDoc = parseXml(drawingFile, drawingPath);
        for (const anchor of Array.from(dDoc.documentElement.children)) {
          const from = anchor.getElementsByTagNameNS(NS.xdr, 'from')[0];
          if (!from) continue;
          const col = parseInt(from.getElementsByTagNameNS(NS.xdr, 'col')[0]?.textContent ?? '-1', 10);
          const row = parseInt(from.getElementsByTagNameNS(NS.xdr, 'row')[0]?.textContent ?? '-1', 10);
          if (col < 0 || row < 0) continue;
          // An anchor can hold a shape rather than a picture — no blip, no image.
          const blip = anchor.getElementsByTagNameNS(NS.a, 'blip')[0];
          const embed = blip?.getAttributeNS(NS.r, 'embed');
          if (!embed) continue;
          const mediaTarget = dRels.get(embed);
          if (!mediaTarget) continue;
          const mediaPath = resolvePath(drawingPath, mediaTarget);
          const bytes = files[mediaPath];
          if (!bytes) continue;
          const ext = (mediaPath.split('.').pop() ?? '').toLowerCase();
          anchors.push({ col, row, image: { path: mediaPath, bytes, mime: MIME[ext] ?? 'image/jpeg' } });
        }
      }
    }

    const colName = (i: number) => {
      let n = i + 1, s2 = '';
      while (n > 0) { const m = (n - 1) % 26; s2 = String.fromCharCode(65 + m) + s2; n = Math.floor((n - 1) / 26); }
      return s2;
    };
    const at = (col: number, row0: number) => cells.get(`${colName(col)}${row0 + 1}`) ?? null;

    // ── locate the table ─────────────────────────────────────────────────────
    //
    // Driven by the PHOTO ANCHORS, not by header wording. Every sheet opens with
    // an info block (LOCATION / AREA / LINE / MACHINE / OEM / MODEL …) whose
    // labels collide with plausible table headers — matching "MACHINE" there
    // yields OEM/MODEL/SERIAL as "tags". The photos are unambiguous, so they
    // locate the table and the wording never has to be recognised.
    let headerRow = -1, tagCol = -1, picCol = -1, how = '';

    const picFromAnchors = modal(anchors.map(a => a.col));
    if (picFromAnchors != null) {
      picCol = picFromAnchors;
      const imageRows = [...new Set(anchors.filter(a => a.col === picCol).map(a => a.row))].sort((a, b) => a - b);
      const firstImageRow = imageRows[0];

      // The header is the last row above the photos carrying a label in the
      // picture column ("Component Picture"); if it is blank, the row directly
      // above the first photo.
      headerRow = firstImageRow - 1;
      for (let r = firstImageRow - 1; r >= 0; r--) {
        if (at(picCol, r)) { headerRow = r; break; }
      }

      // Tag column: walk left from the pictures for a column that actually holds
      // a value on most photo rows. Nearest wins, so intervening blank spacer
      // columns are skipped rather than mistaken for the tag.
      for (let c = picCol - 1; c >= 0 && c >= picCol - 6; c--) {
        const hits = imageRows.filter(r => at(c, r)).length;
        if (hits >= Math.max(1, Math.ceil(imageRows.length * 0.6))) {
          tagCol = c;
          how = at(picCol, headerRow)
            ? `photo column ${colName(picCol)} ("${at(picCol, headerRow)}"), tags in ${colName(c)}${at(c, headerRow) ? ` ("${at(c, headerRow)}")` : ''}`
            : `photo column ${colName(picCol)}, tags in ${colName(c)}`;
          break;
        }
      }
    }

    // No photos on the sheet: fall back to header text, but only on a row that
    // actually looks like a table header (several populated cells in a run).
    if (tagCol < 0) {
      const rowFill = new Map<number, number>();
      for (const ref of cells.keys()) {
        const cr = refToColRow(ref);
        if (cr) rowFill.set(cr.row, (rowFill.get(cr.row) ?? 0) + 1);
      }
      outer: for (const want of TAG_HEADERS) {
        for (const [ref, val] of cells) {
          if (headerKey(val) !== want) continue;
          const cr = refToColRow(ref);
          if (!cr || (rowFill.get(cr.row) ?? 0) < 4) continue;
          headerRow = cr.row; tagCol = cr.col; how = `header text "${val}"`;
          for (const [ref2, val2] of cells) {
            const cr2 = refToColRow(ref2);
            if (cr2 && cr2.row === headerRow && PICTURE_HEADERS.includes(headerKey(val2))) { picCol = cr2.col; break; }
          }
          if (picCol < 0) picCol = tagCol + 1;
          break outer;
        }
      }
    }

    if (headerRow < 0 || tagCol < 0) {
      const seen = [...cells.values()].filter(v => v.length < 28).slice(0, 12);
      diagnostics.push(`${name}: no tag column found (${anchors.length} photos). Cells seen: ${seen.join(' · ') || 'none'}`);
      skipped.push(name);
      continue;
    }

    const byRow = new Map<number, WorkbookImage[]>();
    for (const a of anchors) {
      if (a.col !== picCol) continue;
      const list = byRow.get(a.row) ?? [];
      list.push(a.image);
      byRow.set(a.row, list);
    }

    // ── asset rows: header+1 until the tag column runs dry ───────────────────
    const rows: WorkbookRow[] = [];
    const used = new Set<number>();
    for (let r = headerRow + 1; ; r++) {
      const tag = at(tagCol, r);
      if (!tag) break;
      used.add(r);
      rows.push({
        rowIndex: r,
        tag,
        area:               at(tagCol - 3, r),
        functionalLocation: at(tagCol - 2, r),
        accessibility:      at(picCol + 1, r),
        notes:              at(picCol + 2, r),
        images:             byRow.get(r) ?? [],
      });
    }

    if (!rows.length) {
      diagnostics.push(`${name}: header "${how}" at row ${headerRow + 1} but no rows beneath it`);
      skipped.push(name);
      continue;
    }

    let stray = 0;
    for (const [r, imgs] of byRow) if (!used.has(r)) stray += imgs.length;
    diagnostics.push(`${name}: ${rows.length} rows via "${how}", photos in column ${colName(picCol)}`);

    sheets.push({ name, rows, strayImageCount: stray });
  }

  if (!sheets.length) {
    throw new WorkbookParseError(
      'No asset tables found in this workbook. Looked for a tag column headed Sub System, ' +
      'Component, Machine, Equipment or Tag, and for photos anchored beside it.\n\n' +
      diagnostics.join('\n'),
    );
  }

  return { location, line, machine, sheets, skipped, diagnostics };
}
