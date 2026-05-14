import { useState, useEffect, useRef, useCallback } from 'react';
import { Waves, Upload, Loader2, CheckCircle, AlertTriangle, RefreshCw, Building2, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useScope } from '../context/ScopeContext';
import { importUASData, type ImportResult } from '../utils/uasImporter';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeasurementRow {
  id: string;
  overall_rms: number | null;
  max_rms: number | null;
  peak: number | null;
  crest_factor: number | null;
  alarm_level: string;
  measured_at: string;
  measurement_points: {
    name: string;
    sensor_model: string | null;
    components: {
      name: string;
      equipment: {
        tag: string;
        sections: {
          uas_name: string;
          lines: {
            name: string;
            locations: { name: string };
          };
        };
      };
    };
  };
}

interface FlatRow {
  id: string;
  location: string;
  line: string;
  section: string;
  equipmentTag: string;
  component: string;
  point: string;
  sensorModel: string | null;
  overallRms: number | null;
  maxRms: number | null;
  peak: number | null;
  crestFactor: number | null;
  alarmLevel: string;
  measuredAt: string;
}

interface EquipmentGroup {
  tag: string;
  line: string;
  section: string;
  worstAlarm: string;
  worstRms: number;
  points: FlatRow[];
}

function flatten(m: MeasurementRow): FlatRow {
  const mp = m.measurement_points;
  const comp = mp.components;
  const eq = comp.equipment;
  const sec = eq.sections;
  return {
    id: m.id,
    location: sec.lines.locations.name,
    line: sec.lines.name,
    section: sec.uas_name,
    equipmentTag: eq.tag,
    component: comp.name,
    point: mp.name,
    sensorModel: mp.sensor_model,
    overallRms: m.overall_rms,
    maxRms: m.max_rms,
    peak: m.peak,
    crestFactor: m.crest_factor,
    alarmLevel: m.alarm_level,
    measuredAt: m.measured_at,
  };
}

// ── Alarm config ──────────────────────────────────────────────────────────────

const ALARM_RANK: Record<string, number> = { Normal: 0, Alert: 1, Warning: 2, Danger: 3 };

const ALARM = {
  Danger:  { bg: 'bg-red-50',    border: 'border-red-500',    badge: 'bg-red-100 text-red-700',    bar: 'bg-red-500',    dot: 'bg-red-500',    text: 'text-red-600'    },
  Warning: { bg: 'bg-orange-50', border: 'border-orange-500', badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', text: 'text-orange-600' },
  Alert:   { bg: 'bg-yellow-50', border: 'border-yellow-400', badge: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-400', dot: 'bg-yellow-400', text: 'text-yellow-600' },
  Normal:  { bg: 'bg-white',     border: 'border-green-400',  badge: 'bg-green-100 text-green-700',  bar: 'bg-green-400',  dot: 'bg-green-500',  text: 'text-green-600'  },
};
const A = (level: string) => ALARM[level as keyof typeof ALARM] ?? ALARM.Normal;

function fmt(n: number | null) { return n == null ? '—' : n.toFixed(2); }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Group rows by equipment ───────────────────────────────────────────────────

function groupByEquipment(rows: FlatRow[]): EquipmentGroup[] {
  const map = new Map<string, EquipmentGroup>();
  for (const r of rows) {
    if (!map.has(r.equipmentTag)) {
      map.set(r.equipmentTag, { tag: r.equipmentTag, line: r.line, section: r.section, worstAlarm: 'Normal', worstRms: 0, points: [] });
    }
    const g = map.get(r.equipmentTag)!;
    g.points.push(r);
    if (ALARM_RANK[r.alarmLevel] > ALARM_RANK[g.worstAlarm]) g.worstAlarm = r.alarmLevel;
    if ((r.overallRms ?? 0) > g.worstRms) g.worstRms = r.overallRms ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => ALARM_RANK[b.worstAlarm] - ALARM_RANK[a.worstAlarm] || a.tag.localeCompare(b.tag));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Ultrasound() {
  const { profile } = useAuth();
  const { selectedCompanyId, selectedLocationId } = useScope();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [filterAlarm, setFilterAlarm] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    let query = supabase
      .from('measurements')
      .select(`
        id, overall_rms, max_rms, peak, crest_factor, alarm_level, measured_at,
        measurement_points (
          name, sensor_model,
          components (
            name,
            equipment (
              tag,
              sections (
                uas_name,
                lines (
                  name,
                  locations ( name )
                )
              )
            )
          )
        )
      `)
      .eq('company_id', selectedCompanyId)
      .order('alarm_level');

    if (selectedLocationId) {
      query = query.eq('measurement_points.components.equipment.sections.lines.location_id', selectedLocationId);
    }

    const { data, error } = await query;
    if (!error && data) setRows((data as unknown as MeasurementRow[]).map(flatten));
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedCompanyId || !selectedLocationId) {
      setImportResult({ lines: 0, sections: 0, equipment: 0, components: 0, measurementPoints: 0, measurements: 0, errors: ['Select a company and location in the header before importing.'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setImporting(true); setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = await importUASData(buffer, selectedCompanyId, selectedLocationId);
      setImportResult(result);
      if (!result.errors.length) await fetchData();
    } catch (err) {
      setImportResult({ lines: 0, sections: 0, equipment: 0, components: 0, measurementPoints: 0, measurements: 0, errors: [err instanceof Error ? err.message : 'Unknown error'] });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Derived ─────────────────────────────────────────────────────────────────

  const sections = [...new Set(rows.map(r => r.section))].sort();
  const maxRms = Math.max(...rows.map(r => r.overallRms ?? 0), 1);

  const filtered = rows.filter(r => {
    if (filterAlarm && r.alarmLevel !== filterAlarm) return false;
    if (filterSection && r.section !== filterSection) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.equipmentTag.toLowerCase().includes(q) || r.component.toLowerCase().includes(q) || r.point.toLowerCase().includes(q);
    }
    return true;
  });

  const groups = groupByEquipment(filtered);

  const counts = {
    Danger:  rows.filter(r => r.alarmLevel === 'Danger').length,
    Warning: rows.filter(r => r.alarmLevel === 'Warning').length,
    Alert:   rows.filter(r => r.alarmLevel === 'Alert').length,
    Normal:  rows.filter(r => r.alarmLevel === 'Normal').length,
  };

  const criticalGroups = groupByEquipment(rows).filter(g => g.worstAlarm === 'Danger' || g.worstAlarm === 'Warning').slice(0, 4);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ultrasound Analysis</h1>
          <p className="text-sm text-gray-500">Equipment condition monitoring via UAS measurements</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => fetchData()} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button onClick={() => fileInputRef.current?.click()} disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light transition-colors disabled:opacity-60">
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Importing…' : 'Import Measurements'}
          </button>
        </div>
      </div>

      {/* Import banner */}
      {importResult && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-xl border ${importResult.errors.length ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {importResult.errors.length
            ? <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            : <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />}
          <div>
            {importResult.errors.length
              ? <p className="text-sm font-semibold text-red-700">{importResult.errors.join(' · ')}</p>
              : <>
                  <p className="text-sm font-semibold text-green-700">Import successful</p>
                  <p className="text-xs text-green-600 mt-0.5">{importResult.measurements} measurements · {importResult.measurementPoints} points · {importResult.equipment} equipment · {importResult.sections} sections · {importResult.lines} lines</p>
                </>}
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-32"><Loader2 size={28} className="animate-spin text-gray-300" /></div>
      ) : !selectedCompanyId ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-400">
          <Building2 size={48} className="mb-4 opacity-30" />
          <p className="text-sm font-medium">No company selected</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-gray-400">
          <Waves size={48} className="mb-4 opacity-30" />
          <p className="text-sm font-medium">No ultrasound data yet</p>
          <p className="text-xs mt-1">Click "Import Measurements" to load your first export</p>
        </div>
      ) : (
        <>
          {/* Status bar */}
          <div className="grid grid-cols-4 gap-3">
            {(['Danger', 'Warning', 'Alert', 'Normal'] as const).map(level => {
              const cfg = A(level);
              return (
                <button key={level} onClick={() => setFilterAlarm(filterAlarm === level ? '' : level)}
                  className={`rounded-xl border-l-4 border border-gray-200 bg-white px-4 py-3 text-left transition-all hover:shadow-sm ${
                    filterAlarm === level ? `${cfg.bg} border-l-current` : ''
                  } ${cfg.border.replace('border-', 'border-l-')}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{level}</span>
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  </div>
                  <p className="text-3xl font-bold text-gray-900 mt-1">{counts[level]}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">points</p>
                </button>
              );
            })}
          </div>

          {/* Critical equipment spotlight */}
          {criticalGroups.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-red-500" />
                <h2 className="text-xs font-bold text-gray-700 uppercase tracking-wide">Needs Attention</h2>
                <span className="text-xs text-gray-400">— highest severity equipment</span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {criticalGroups.map(g => {
                  const cfg = A(g.worstAlarm);
                  const barPct = Math.round((g.worstRms / maxRms) * 100);
                  return (
                    <div key={g.tag} className={`rounded-lg border-l-4 p-3 ${cfg.bg} ${cfg.border.replace('border-', 'border-l-')}`}>
                      <p className="text-xs font-bold text-gray-800 truncate">{g.tag}</p>
                      <p className="text-[10px] text-gray-400 truncate mb-2">{g.line} · {g.section}</p>
                      <div className="w-full bg-white/60 rounded-full h-1.5 mb-1">
                        <div className={`h-1.5 rounded-full ${cfg.bar}`} style={{ width: `${barPct}%` }} />
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">RMS {g.worstRms.toFixed(2)}</span>
                        <span className={`text-[10px] font-bold ${cfg.text}`}>{g.worstAlarm}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Search equipment, component, point…" value={search} onChange={e => setSearch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
              <option value="">All Sections</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(filterAlarm || filterSection || search) && (
              <button onClick={() => { setFilterAlarm(''); setFilterSection(''); setSearch(''); }} className="text-xs text-primary hover:underline">
                Clear filters
              </button>
            )}
            <span className="text-xs text-gray-400 ml-auto">{groups.length} equipment · {filtered.length} points</span>
          </div>

          {/* Equipment cards */}
          <div className="space-y-3">
            {groups.map(g => {
              const cfg = A(g.worstAlarm);
              return (
                <div key={g.tag} className={`rounded-xl border border-gray-200 border-l-4 overflow-hidden ${cfg.border.replace('border-', 'border-l-')}`}>
                  {/* Equipment header */}
                  <div className={`flex items-center justify-between px-4 py-3 ${cfg.bg}`}>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-bold text-gray-900 font-mono">{g.tag}</p>
                      <span className="text-xs text-gray-400">{g.line}</span>
                      <span className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400 max-w-[200px] truncate">{g.section}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{g.points.length} point{g.points.length !== 1 ? 's' : ''}</span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${cfg.badge}`}>
                        {g.worstAlarm}
                      </span>
                    </div>
                  </div>

                  {/* Measurement points */}
                  <div className="divide-y divide-gray-50">
                    {g.points.map(r => {
                      const pcfg = A(r.alarmLevel);
                      const barPct = r.overallRms != null ? Math.round((r.overallRms / maxRms) * 100) : 0;
                      return (
                        <div key={r.id} className="flex items-center gap-4 px-4 py-2.5 bg-white hover:bg-gray-50/60 transition-colors">
                          {/* Point name */}
                          <div className="w-48 shrink-0">
                            <p className="text-xs font-semibold text-gray-700 truncate">{r.point}</p>
                            <p className="text-[10px] text-gray-400 truncate">{r.component}</p>
                          </div>

                          {/* RMS bar */}
                          <div className="flex-1 flex items-center gap-2 min-w-0">
                            <div className="flex-1 bg-gray-100 rounded-full h-2">
                              <div className={`h-2 rounded-full transition-all ${pcfg.bar}`} style={{ width: `${barPct}%` }} />
                            </div>
                            <span className="text-xs font-mono text-gray-600 w-12 text-right shrink-0">{fmt(r.overallRms)}</span>
                          </div>

                          {/* Stats */}
                          <div className="hidden lg:flex items-center gap-5 shrink-0 text-xs text-gray-500 font-mono">
                            <span title="Max RMS"><span className="text-gray-300 mr-1">max</span>{fmt(r.maxRms)}</span>
                            <span title="Peak"><span className="text-gray-300 mr-1">pk</span>{fmt(r.peak)}</span>
                            <span title="Crest Factor"><span className="text-gray-300 mr-1">cf</span>{fmt(r.crestFactor)}</span>
                          </div>

                          {/* Alarm badge */}
                          <div className="shrink-0 w-20 text-right">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${pcfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${pcfg.dot}`} />
                              {r.alarmLevel}
                            </span>
                          </div>

                          {/* Date */}
                          <span className="text-[10px] text-gray-300 shrink-0 w-20 text-right hidden xl:block">{fmtDate(r.measuredAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
