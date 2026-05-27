import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

// ── Parsed row from UAS export ────────────────────────────────────────────────

interface ParsedRow {
  line: string;
  section: string;
  equipmentTag: string;
  component: string;
  measurementPoint: string;
  sensorModel: string;
  alarmLevel: string;
  measuredAt: string;
  overallRms: number | null;
  maxRms: number | null;
  peak: number | null;
  crestFactor: number | null;
}

function rowPathKey(r: ParsedRow): string {
  return `${r.line}|${r.section}|${r.equipmentTag}|${r.component}|${r.measurementPoint}`;
}

function toDate(raw: unknown): string {
  // JS Date object (from cellDates: true)
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const d = String(raw.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw ?? '').trim();
  // Excel serial date number — 5-digit integer, e.g. "46156"
  if (/^\d{5,6}$/.test(s)) {
    const serial = parseInt(s, 10);
    // Excel epoch is Dec 30 1899 (accounts for Excel's 1900 leap-year bug)
    const ms = Date.UTC(1899, 11, 30) + serial * 86_400_000;
    const dt = new Date(ms);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  }
  // M/D/YYYY  or  M/D/YY
  const slashParts = s.split('/');
  if (slashParts.length === 3) {
    const [mm, dd, yy] = slashParts;
    const yyyy = yy.length === 2 ? `20${yy}` : yy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  // Already ISO (YYYY-MM-DD) or unrecognised — return as-is
  return s;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return v === '' || v === null || v === undefined || isNaN(n) ? null : n;
}

function uniq<T>(arr: T[], key: (item: T) => string): T[] {
  return [...new Map(arr.map(item => [key(item), item])).values()];
}

export function parseUASFile(buffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const ws = wb.Sheets['MeasureDetails'];
  if (!ws) throw new Error('Sheet "MeasureDetails" not found. Make sure this is a UAS export file.');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' }) as unknown[][];

  return rows
    .slice(1)
    .filter(row => row[0])
    .flatMap(row => {
      const segs = String(row[0]).trim().split('\\');
      if (segs.length < 7) return [];
      return [{
        line:             segs[2].trim(),
        section:          segs[3].trim(),
        equipmentTag:     segs[4].trim(),
        component:        segs[5].trim(),
        measurementPoint: segs[6].trim(),
        sensorModel:      segs[7]?.trim() ?? '',
        alarmLevel:  String(row[1] || 'Normal').trim(),
        measuredAt:  toDate(row[2]),
        overallRms:  toNum(row[3]),
        maxRms:      toNum(row[4]),
        peak:        toNum(row[5]),
        crestFactor: toNum(row[6]),
      }];
    });
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface HierarchyResult {
  lines: number;
  sections: number;
  equipment: number;
  components: number;
  measurementPoints: number;
  errors: string[];
}

export interface ImportResult extends HierarchyResult {
  measurements: number;
}

// ── Shared: upsert lines → measurement_points ─────────────────────────────────
// Returns mpMap keyed by FULL ROW PATH (line|section|equip|comp|point) → mp UUID.
// This avoids any map-rebuild in the caller and is immune to ID-chain mismatches.

async function upsertHierarchy(
  rows: ParsedRow[],
  companyId: string,
  locationId: string,
): Promise<{
  result: HierarchyResult;
  mpMap: Map<string, string>;   // rowPathKey → measurement_point.id
}> {
  const result: HierarchyResult = {
    lines: 0, sections: 0, equipment: 0,
    components: 0, measurementPoints: 0, errors: [],
  };
  const empty = { result, mpMap: new Map<string, string>() };

  // 1 ── Lines ────────────────────────────────────────────────────────────────
  const { data: lineData, error: lineErr } = await supabase
    .from('lines')
    .upsert(
      uniq(rows, r => r.line).map(r => ({
        location_id: locationId,
        company_id:  companyId,
        name:        r.line,
      })),
      { onConflict: 'location_id,name' },
    )
    .select('id, name');
  if (lineErr) { result.errors.push(`Lines: ${lineErr.message}`); return empty; }
  const lineMap = new Map(lineData!.map(l => [l.name, l.id as string]));
  result.lines = lineData!.length;

  // 2 ── Sections ─────────────────────────────────────────────────────────────
  const { data: secData, error: secErr } = await supabase
    .from('sections')
    .upsert(
      uniq(rows, r => `${r.line}|${r.section}`).map(r => ({
        line_id:    lineMap.get(r.line)!,
        company_id: companyId,
        uas_name:   r.section,
      })),
      { onConflict: 'line_id,uas_name' },
    )
    .select('id, uas_name, line_id');
  if (secErr) { result.errors.push(`Sections: ${secErr.message}`); return empty; }
  const secMap = new Map(secData!.map(s => [`${s.line_id}|${s.uas_name}`, s.id as string]));
  result.sections = secData!.length;

  // 3 ── Equipment ────────────────────────────────────────────────────────────
  const { data: eqData, error: eqErr } = await supabase
    .from('equipment')
    .upsert(
      uniq(rows, r => `${r.line}|${r.section}|${r.equipmentTag}`).map(r => {
        const lineId = lineMap.get(r.line)!;
        return {
          section_id: secMap.get(`${lineId}|${r.section}`)!,
          company_id: companyId,
          tag:        r.equipmentTag,
        };
      }),
      { onConflict: 'section_id,tag' },
    )
    .select('id, tag, section_id');
  if (eqErr) { result.errors.push(`Equipment: ${eqErr.message}`); return empty; }
  const eqMap = new Map(eqData!.map(e => [`${e.section_id}|${e.tag}`, e.id as string]));
  result.equipment = eqData!.length;

  // 4 ── Components ───────────────────────────────────────────────────────────
  const { data: compData, error: compErr } = await supabase
    .from('components')
    .upsert(
      uniq(rows, r => `${r.line}|${r.section}|${r.equipmentTag}|${r.component}`).map(r => {
        const lineId = lineMap.get(r.line)!;
        const secId  = secMap.get(`${lineId}|${r.section}`)!;
        return {
          equipment_id: eqMap.get(`${secId}|${r.equipmentTag}`)!,
          company_id:   companyId,
          name:         r.component,
        };
      }),
      { onConflict: 'equipment_id,name' },
    )
    .select('id, name, equipment_id');
  if (compErr) { result.errors.push(`Components: ${compErr.message}`); return empty; }
  const compMap = new Map(compData!.map(c => [`${c.equipment_id}|${c.name}`, c.id as string]));
  result.components = compData!.length;

  // 5 ── Measurement Points ───────────────────────────────────────────────────
  // Build the upsert payload while also tracking path → component_id
  // so we can build the final mpMap keyed by full row path.
  const mpUpsertRows = uniq(rows, rowPathKey).map(r => {
    const lineId = lineMap.get(r.line)!;
    const secId  = secMap.get(`${lineId}|${r.section}`)!;
    const eqId   = eqMap.get(`${secId}|${r.equipmentTag}`)!;
    const cId    = compMap.get(`${eqId}|${r.component}`)!;
    return {
      _pathKey:     rowPathKey(r),   // used only for mpMap construction, NOT sent to DB
      component_id: cId,
      company_id:   companyId,
      name:         r.measurementPoint,
      sensor_model: r.sensorModel || null,
    };
  });

  const { data: mpData, error: mpErr } = await supabase
    .from('measurement_points')
    .upsert(
      mpUpsertRows.map(({ _pathKey: _pk, ...rest }) => rest),  // strip _pathKey before sending
      { onConflict: 'component_id,name' },
    )
    .select('id, name, component_id');
  if (mpErr) { result.errors.push(`Measurement points: ${mpErr.message}`); return empty; }
  result.measurementPoints = mpData!.length;

  // Build a component_id|name → mp UUID lookup from the upsert result
  const mpByCompAndName = new Map(mpData!.map(mp => [`${mp.component_id}|${mp.name}`, mp.id as string]));

  // Build the final mpMap keyed by FULL ROW PATH using the same IDs we used above
  const mpMap = new Map<string, string>();
  for (const row of mpUpsertRows) {
    const mpId = mpByCompAndName.get(`${row.component_id}|${row.name}`);
    if (mpId) mpMap.set(row._pathKey, mpId);
  }

  return { result, mpMap };
}

// ── Public: hierarchy only (Assets tab) ──────────────────────────────────────

export async function importUASHierarchy(
  buffer: ArrayBuffer,
  companyId: string,
  locationId: string,
): Promise<HierarchyResult> {
  let rows: ParsedRow[];
  try {
    rows = parseUASFile(buffer);
  } catch (err) {
    return {
      lines: 0, sections: 0, equipment: 0,
      components: 0, measurementPoints: 0,
      errors: [err instanceof Error ? err.message : 'Unknown error'],
    };
  }
  if (!rows.length) {
    return {
      lines: 0, sections: 0, equipment: 0,
      components: 0, measurementPoints: 0,
      errors: ['No valid rows found in file.'],
    };
  }
  const { result } = await upsertHierarchy(rows, companyId, locationId);
  return result;
}

// ── Public: full import with measurements (Ultrasound tab) ───────────────────

export async function importUASData(
  buffer: ArrayBuffer,
  companyId: string,
  locationId: string,
): Promise<ImportResult> {
  let rows: ParsedRow[];
  try {
    rows = parseUASFile(buffer);
  } catch (err) {
    return {
      lines: 0, sections: 0, equipment: 0,
      components: 0, measurementPoints: 0, measurements: 0,
      errors: [err instanceof Error ? err.message : 'Unknown error'],
    };
  }
  if (!rows.length) {
    return {
      lines: 0, sections: 0, equipment: 0,
      components: 0, measurementPoints: 0, measurements: 0,
      errors: ['No valid rows found in file.'],
    };
  }

  const { result: hierResult, mpMap } = await upsertHierarchy(rows, companyId, locationId);
  if (hierResult.errors.length) {
    return { ...hierResult, measurements: 0 };
  }

  // 6 ── Measurements ────────────────────────────────────────────────────────
  // mpMap is keyed by full row path — no secondary map lookups needed.
  const allMeas = rows.flatMap(r => {
    const mpId = mpMap.get(rowPathKey(r));
    if (!mpId) return [];
    return [{
      measurement_point_id: mpId,
      company_id:           companyId,
      location_id:          locationId,
      overall_rms:          r.overallRms,
      max_rms:              r.maxRms,
      peak:                 r.peak,
      crest_factor:         r.crestFactor,
      alarm_level:          r.alarmLevel,
      measured_at:          r.measuredAt,
    }];
  });

  // Deduplicate on (point + date) so re-importing the same file is idempotent
  const measDeduped = [
    ...new Map(
      allMeas.map(m => [`${m.measurement_point_id}|${m.measured_at}`, m]),
    ).values(),
  ];

  if (measDeduped.length === 0) {
    return { ...hierResult, measurements: 0, errors: ['No measurements resolved — check that the file was imported for the correct location.'] };
  }

  const { data: measData, error: measErr } = await supabase
    .from('measurements')
    .upsert(measDeduped, { onConflict: 'measurement_point_id,measured_at' })
    .select('id');
  if (measErr) {
    return { ...hierResult, measurements: 0, errors: [`Measurements: ${measErr.message}`] };
  }

  return { ...hierResult, measurements: measData!.length };
}
