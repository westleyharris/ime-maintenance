import { useState, useEffect, useRef, useCallback } from 'react';
import { Waves, Upload, Loader2, CheckCircle, AlertTriangle, RefreshCw, Building2 } from 'lucide-react';
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

// ── Alarm styling ─────────────────────────────────────────────────────────────

const alarmColors: Record<string, string> = {
  Normal:  'bg-green-100 text-green-700 border-green-200',
  Alert:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  Warning: 'bg-orange-100 text-orange-700 border-orange-200',
  Danger:  'bg-red-100 text-red-700 border-red-200',
};

const alarmDot: Record<string, string> = {
  Normal:  'bg-green-500',
  Alert:   'bg-yellow-400',
  Warning: 'bg-orange-500',
  Danger:  'bg-red-500',
};

function fmt(n: number | null) {
  return n == null ? '—' : n.toFixed(2);
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

    // Filter by location if one is selected
    if (selectedLocationId) {
      query = query.eq('measurement_points.components.equipment.sections.lines.location_id', selectedLocationId);
    }

    const { data, error } = await query;

    if (!error && data) {
      setRows((data as unknown as MeasurementRow[]).map(flatten));
    }
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedCompanyId || !selectedLocationId) {
      setImportResult({
        lines: 0, sections: 0, equipment: 0,
        components: 0, measurementPoints: 0, measurements: 0,
        errors: ['Select a company and location in the header before importing.'],
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const result = await importUASData(buffer, selectedCompanyId, selectedLocationId);
      setImportResult(result);
      if (!result.errors.length) await fetchData();
    } catch (err) {
      setImportResult({
        lines: 0, sections: 0, equipment: 0,
        components: 0, measurementPoints: 0, measurements: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────

  const sections = [...new Set(rows.map(r => r.section))].sort();

  const filtered = rows.filter(r => {
    if (filterAlarm && r.alarmLevel !== filterAlarm) return false;
    if (filterSection && r.section !== filterSection) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.equipmentTag.toLowerCase().includes(q) || r.component.toLowerCase().includes(q) || r.point.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {
    Normal:  rows.filter(r => r.alarmLevel === 'Normal').length,
    Alert:   rows.filter(r => r.alarmLevel === 'Alert').length,
    Warning: rows.filter(r => r.alarmLevel === 'Warning').length,
    Danger:  rows.filter(r => r.alarmLevel === 'Danger').length,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ultrasound Analysis</h1>
          <p className="text-sm text-gray-500">Import UAS exports to load measurements across all assets</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchData()}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light transition-colors disabled:opacity-60"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {importing ? 'Importing…' : 'Import Measurements'}
          </button>
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className={`flex items-start gap-3 px-5 py-4 rounded-xl border ${importResult.errors.length ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
          {importResult.errors.length
            ? <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            : <CheckCircle size={18} className="text-green-500 shrink-0 mt-0.5" />
          }
          <div>
            {importResult.errors.length
              ? <p className="text-sm font-semibold text-red-700">{importResult.errors.join(' · ')}</p>
              : (
                <>
                  <p className="text-sm font-semibold text-green-700">Import successful</p>
                  <p className="text-xs text-green-600 mt-0.5">
                    {importResult.measurements} measurements · {importResult.measurementPoints} points · {importResult.equipment} equipment · {importResult.sections} sections · {importResult.lines} lines
                  </p>
                </>
              )
            }
          </div>
        </div>
      )}

      {/* Alarm stats */}
      {rows.length > 0 && (
        <div className="grid grid-cols-4 gap-4">
          {(['Normal', 'Alert', 'Warning', 'Danger'] as const).map(level => (
            <button
              key={level}
              onClick={() => setFilterAlarm(filterAlarm === level ? '' : level)}
              className={`rounded-xl border p-4 text-left transition-all ${
                filterAlarm === level
                  ? alarmColors[level]
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-2.5 h-2.5 rounded-full ${alarmDot[level]}`} />
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{level}</span>
              </div>
              <p className="text-3xl font-bold text-gray-900">{counts[level]}</p>
              <p className="text-xs text-gray-400 mt-0.5">measurement points</p>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      {rows.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Search equipment tag, component, point…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
            <option value="">All Sections</option>
            {sections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(filterAlarm || filterSection || search) && (
            <button
              onClick={() => { setFilterAlarm(''); setFilterSection(''); setSearch(''); }}
              className="text-xs text-primary hover:underline"
            >
              Clear filters
            </button>
          )}
          <span className="text-xs text-gray-400 ml-auto">{filtered.length} of {rows.length} points</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-gray-300" />
          </div>
        ) : !selectedCompanyId ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Building2 size={48} className="mb-4 opacity-30" />
            <p className="text-sm font-medium">No company selected</p>
            <p className="text-xs mt-1">Select a company from the header to view data</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Waves size={48} className="mb-4 opacity-30" />
            <p className="text-sm font-medium">No ultrasound data yet</p>
            <p className="text-xs mt-1">Click "Import UAS Data" to load your first export</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Equipment Tag</th>
                  <th className="text-left px-4 py-3">Component</th>
                  <th className="text-left px-4 py-3">Point</th>
                  <th className="text-left px-4 py-3">Section</th>
                  <th className="text-right px-4 py-3">Overall RMS</th>
                  <th className="text-right px-4 py-3">Max RMS</th>
                  <th className="text-right px-4 py-3">Peak</th>
                  <th className="text-right px-4 py-3">Crest Factor</th>
                  <th className="text-center px-4 py-3">Alarm</th>
                  <th className="text-left px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{row.equipmentTag}</td>
                    <td className="px-4 py-2.5 text-gray-700">{row.component}</td>
                    <td className="px-4 py-2.5 font-semibold text-gray-800">{row.point}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs max-w-[200px] truncate">{row.section}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmt(row.overallRms)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmt(row.maxRms)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmt(row.peak)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{fmt(row.crestFactor)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${alarmColors[row.alarmLevel] ?? alarmColors.Normal}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${alarmDot[row.alarmLevel] ?? alarmDot.Normal}`} />
                        {row.alarmLevel}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{row.measuredAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
