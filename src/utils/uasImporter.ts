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

function toDate(raw: string): string {
  const parts = raw.split('/');
  if (parts.length !== 3) return raw;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return v === '' || v === null || v === undefined || isNaN(n) ? null : n;
}

function uniq<T>(arr: T[], key: (item: T) => string): T[] {
  return [...new Map(arr.map(item => [key(item), item])).values()];
}

export function parseUASFile(buffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buffer, { type: 'array' });
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
        line: segs[2].trim(),
        section: segs[3].trim(),
        equipmentTag: segs[4].trim(),
        component: segs[5].trim(),
        measurementPoint: segs[6].trim(),
        sensorModel: segs[7]?.trim() ?? '',
        alarmLevel: String(row[1] || 'Normal').trim(),
        measuredAt: toDate(String(row[2] || '')),
        overallRms: toNum(row[3]),
        maxRms: toNum(row[4]),
        peak: toNum(row[5]),
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

// ── Shared: upsert lines → measurement_points, return maps ───────────────────

async function upsertHierarchy(
  rows: ParsedRow[],
  companyId: string,
  locationId: string,
): Promise<{
  result: HierarchyResult;
  mpMap: Map<string, string>;
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
        company_id: companyId,
        name: r.line,
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
        line_id: lineMap.get(r.line)!,
        company_id: companyId,
        uas_name: r.section,
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
        return { section_id: secMap.get(`${lineId}|${r.section}`)!, company_id: companyId, tag: r.equipmentTag };
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
        const secId = secMap.get(`${lineId}|${r.section}`)!;
        return { equipment_id: eqMap.get(`${secId}|${r.equipmentTag}`)!, company_id: companyId, name: r.component };
      }),
      { onConflict: 'equipment_id,name' },
    )
    .select('id, name, equipment_id');
  if (compErr) { result.errors.push(`Components: ${compErr.message}`); return empty; }
  const compMap = new Map(compData!.map(c => [`${c.equipment_id}|${c.name}`, c.id as string]));
  result.components = compData!.length;

  // 5 ── Measurement Points ───────────────────────────────────────────────────
  const { data: mpData, error: mpErr } = await supabase
    .from('measurement_points')
    .upsert(
      uniq(rows, r => `${r.line}|${r.section}|${r.equipmentTag}|${r.component}|${r.measurementPoint}`).map(r => {
        const lineId = lineMap.get(r.line)!;
        const secId = secMap.get(`${lineId}|${r.section}`)!;
        const eqId = eqMap.get(`${secId}|${r.equipmentTag}`)!;
        const cId = compMap.get(`${eqId}|${r.component}`)!;
        return {
          component_id: cId,
          company_id: companyId,
          name: r.measurementPoint,
          sensor_model: r.sensorModel || null,
        };
      }),
      { onConflict: 'component_id,name' },
    )
    .select('id, name, component_id');
  if (mpErr) { result.errors.push(`Measurement points: ${mpErr.message}`); return empty; }
  const mpMap = new Map(mpData!.map(mp => [`${mp.component_id}|${mp.name}`, mp.id as string]));
  result.measurementPoints = mpData!.length;

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

  // Rebuild maps needed for measurement lookup
  // (mpMap is already built by upsertHierarchy)
  const { data: lineData } = await supabase.from('lines').select('id, name').eq('location_id', locationId).eq('company_id', companyId);
  const lineMap = new Map((lineData ?? []).map(l => [l.name, l.id as string]));

  const { data: secData } = await supabase.from('sections').select('id, uas_name, line_id').eq('company_id', companyId);
  const secMap = new Map((secData ?? []).map(s => [`${s.line_id}|${s.uas_name}`, s.id as string]));

  const { data: eqData } = await supabase.from('equipment').select('id, tag, section_id').eq('company_id', companyId);
  const eqMap = new Map((eqData ?? []).map(e => [`${e.section_id}|${e.tag}`, e.id as string]));

  const { data: compData } = await supabase.from('components').select('id, name, equipment_id').eq('company_id', companyId);
  const compMap = new Map((compData ?? []).map(c => [`${c.equipment_id}|${c.name}`, c.id as string]));

  // 6 ── Measurements (latest date wins per point) ────────────────────────────
  const allMeas = rows.flatMap(r => {
    const lineId = lineMap.get(r.line);
    const secId = secMap.get(`${lineId}|${r.section}`);
    const eqId = eqMap.get(`${secId}|${r.equipmentTag}`);
    const cId = compMap.get(`${eqId}|${r.component}`);
    const mpId = mpMap.get(`${cId}|${r.measurementPoint}`);
    if (!mpId) return [];
    return [{
      measurement_point_id: mpId,
      company_id: companyId,
      overall_rms: r.overallRms,
      max_rms: r.maxRms,
      peak: r.peak,
      crest_factor: r.crestFactor,
      alarm_level: r.alarmLevel,
      measured_at: r.measuredAt,
    }];
  });

  // Deduplicate on (point + date) so re-importing the same file is idempotent
  const measDeduped = [
    ...new Map(
      allMeas.map(m => [`${m.measurement_point_id}|${m.measured_at}`, m]),
    ).values(),
  ];

  const { data: measData, error: measErr } = await supabase
    .from('measurements')
    .upsert(measDeduped, { onConflict: 'measurement_point_id,measured_at' })
    .select('id');
  if (measErr) {
    return { ...hierResult, measurements: 0, errors: [`Measurements: ${measErr.message}`] };
  }

  return { ...hierResult, measurements: measData!.length };
}
