import { useState, useEffect, useCallback } from 'react';
import { Download, Loader2, FileBarChart2, AlertTriangle, ShieldAlert, AlertCircle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useScope } from '../context/ScopeContext';

interface MeasurementRow {
  id: string;
  overall_rms: number | null;
  max_rms: number | null;
  peak: number | null;
  crest_factor: number | null;
  alarm_level: string | null;
  measured_at: string | null;
  measurement_points: {
    name: string;
    components: {
      name: string;
      equipment: {
        tag: string;
        sections: {
          lines: { name: string } | null;
        } | null;
      } | null;
    } | null;
  } | null;
}

interface FlatRow {
  line: string;
  equipment: string;
  component: string;
  point: string;
  overallRms: number | null;
  maxRms: number | null;
  peak: number | null;
  crestFactor: number | null;
  alarmLevel: string;
  measuredAt: string;
}

const ALARM_CONFIG: Record<string, { label: string; dot: string; bg: string; text: string; icon: React.ReactNode }> = {
  Danger:  { label: 'Danger',  dot: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700',    icon: <ShieldAlert size={15} /> },
  Warning: { label: 'Warning', dot: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', icon: <AlertTriangle size={15} /> },
  Alert:   { label: 'Alert',   dot: 'bg-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700', icon: <AlertCircle size={15} /> },
  Normal:  { label: 'Normal',  dot: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  icon: <CheckCircle2 size={15} /> },
};

const ALARM_ORDER = ['Danger', 'Warning', 'Alert', 'Normal'];

function fmt(val: number | null, decimals = 2) {
  return val != null ? val.toFixed(decimals) : '—';
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function Reports() {
  const { selectedCompanyId, selectedLocationId } = useScope();

  const [rows, setRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filterAlarm, setFilterAlarm] = useState<string>('');

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); return; }
    setLoading(true);

    let query = supabase
      .from('measurements')
      .select(`
        id, overall_rms, max_rms, peak, crest_factor, alarm_level, measured_at,
        measurement_points (
          name,
          components (
            name,
            equipment (
              tag,
              sections ( lines ( name ) )
            )
          )
        )
      `)
      .eq('company_id', selectedCompanyId)
      .order('measured_at', { ascending: false });

    if (selectedLocationId) {
      query = query.eq('measurement_points.components.equipment.sections.lines.location_id', selectedLocationId);
    }
    if (fromDate) query = query.gte('measured_at', fromDate);
    if (toDate)   query = query.lte('measured_at', toDate + 'T23:59:59');

    const { data } = await query;

    const flat: FlatRow[] = ((data ?? []) as unknown as MeasurementRow[])
      .filter(m => m.measurement_points)
      .map(m => ({
        line:        m.measurement_points?.components?.equipment?.sections?.lines?.name ?? '—',
        equipment:   m.measurement_points?.components?.equipment?.tag ?? '—',
        component:   m.measurement_points?.components?.name ?? '—',
        point:       m.measurement_points?.name ?? '—',
        overallRms:  m.overall_rms,
        maxRms:      m.max_rms,
        peak:        m.peak,
        crestFactor: m.crest_factor,
        alarmLevel:  m.alarm_level ?? 'Normal',
        measuredAt:  m.measured_at ?? '',
      }));

    setRows(flat);
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId, fromDate, toDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const displayed = filterAlarm ? rows.filter(r => r.alarmLevel === filterAlarm) : rows;

  const counts = ALARM_ORDER.reduce<Record<string, number>>((acc, lvl) => {
    acc[lvl] = rows.filter(r => r.alarmLevel === lvl).length;
    return acc;
  }, {});

  const exportCSV = () => {
    const headers = ['Line', 'Equipment', 'Component', 'Measurement Point', 'Overall RMS', 'Max RMS', 'Peak', 'Crest Factor', 'Alarm Level', 'Date'];
    const csvRows = displayed.map(r => [
      r.line, r.equipment, r.component, r.point,
      r.overallRms ?? '', r.maxRms ?? '', r.peak ?? '', r.crestFactor ?? '',
      r.alarmLevel, fmtDate(r.measuredAt),
    ].map(v => `"${v}"`).join(','));
    const blob = new Blob([headers.join(',') + '\n' + csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `measurements_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-gray-400 gap-3">
        <FileBarChart2 size={36} className="opacity-30" />
        <p className="text-sm">Select a company to generate a report</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5 hidden sm:block">Measurement data export and summary</p>
        </div>
        <button
          onClick={exportCSV}
          disabled={displayed.length === 0}
          className="flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-40 transition-colors shrink-0"
        >
          <Download size={15} />
          <span className="hidden sm:inline">Export CSV</span>
          <span className="sm:hidden">Export</span>
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {ALARM_ORDER.map(lvl => {
          const cfg = ALARM_CONFIG[lvl];
          return (
            <button
              key={lvl}
              onClick={() => setFilterAlarm(filterAlarm === lvl ? '' : lvl)}
              className={`flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                filterAlarm === lvl
                  ? `${cfg.bg} border-current ${cfg.text}`
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <span className={`${cfg.dot} w-2.5 h-2.5 rounded-full shrink-0`} />
              <div>
                <p className="text-xs text-gray-500 font-medium">{cfg.label}</p>
                <p className={`text-xl font-bold ${filterAlarm === lvl ? cfg.text : 'text-gray-900'}`}>
                  {loading ? '—' : counts[lvl]}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-gray-500">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </div>
        {(fromDate || toDate || filterAlarm) && (
          <button onClick={() => { setFromDate(''); setToDate(''); setFilterAlarm(''); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {loading ? 'Loading…' : `${displayed.length} of ${rows.length} measurements`}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <FileBarChart2 size={28} className="opacity-30" />
            <p className="text-sm">No measurements found for the selected filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Line', 'Equipment', 'Component', 'Point', 'Overall RMS', 'Max RMS', 'Peak', 'Crest Factor', 'Alarm', 'Date'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayed.map((r, i) => {
                  const cfg = ALARM_CONFIG[r.alarmLevel] ?? ALARM_CONFIG.Normal;
                  return (
                    <tr key={i} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-2.5 text-gray-700 font-medium whitespace-nowrap">{r.line}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.equipment}</td>
                      <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{r.component}</td>
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{r.point}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{fmt(r.overallRms)}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{fmt(r.maxRms)}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{fmt(r.peak)}</td>
                      <td className="px-4 py-2.5 text-gray-700 font-mono text-xs">{fmt(r.crestFactor)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {r.alarmLevel}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap text-xs">{fmtDate(r.measuredAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
