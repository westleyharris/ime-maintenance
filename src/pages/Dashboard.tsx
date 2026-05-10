import { useState, useEffect, useCallback } from 'react';
import { Calendar, RefreshCw, Loader2, Building2, ChevronDown, ChevronUp } from 'lucide-react';
import { useScope } from '../context/ScopeContext';
import { supabase } from '../lib/supabase';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeasurementRow {
  alarm_level: string;
  measured_at: string;
  measurement_points: {
    name: string;
    components: {
      equipment: {
        tag: string;
        sections: { lines: { name: string } };
      };
    };
  };
}

interface FlatAlarm {
  alarmLevel: string;
  measuredAt: string;
  line: string;
  equipmentTag: string;
  point: string;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const ALARM = {
  Danger:  { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-200',    row: 'hover:bg-red-50/50',    border: 'border-red-200',    bg: 'bg-red-50',    title: 'text-red-700',    label: 'Equipment Under Danger',        color: '#ef4444' },
  Warning: { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 border-orange-200', row: 'hover:bg-orange-50/50', border: 'border-orange-200', bg: 'bg-orange-50', title: 'text-orange-700', label: 'Equipment Under Warning',       color: '#f97316' },
  Alert:   { dot: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', row: 'hover:bg-yellow-50/50', border: 'border-yellow-200', bg: 'bg-yellow-50', title: 'text-yellow-700', label: 'Equipment Under Slight Warning', color: '#eab308' },
  Normal:  { dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700 border-green-200',  row: '',                      border: 'border-green-200',  bg: 'bg-green-50',  title: 'text-green-700',  label: 'Normal',                        color: '#22c55e' },
};

const PREVIEW_COUNT = 3;

function formatDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ level, count, total }: { level: keyof typeof ALARM; count: number; total: number }) {
  const t = ALARM[level];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full ${t.dot}`} />
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{level}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900">{count}</p>
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: t.color }} />
      </div>
      <p className="text-xs text-gray-400">{pct}% of all points</p>
    </div>
  );
}

// ── Alarm panel ───────────────────────────────────────────────────────────────

function AlarmPanel({ level, rows }: { level: 'Danger' | 'Warning' | 'Alert'; rows: FlatAlarm[] }) {
  const [expanded, setExpanded] = useState(false);
  const t = ALARM[level];
  const visible = expanded ? rows : rows.slice(0, PREVIEW_COUNT);
  const hasMore = rows.length > PREVIEW_COUNT;

  return (
    <div className={`rounded-xl border ${t.border} overflow-hidden`}>
      {/* Panel header */}
      <div className={`${t.bg} px-4 py-3 flex items-center gap-2.5`}>
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${t.dot}`} />
        <span className={`text-xs font-bold uppercase tracking-widest flex-1 ${t.title}`}>{t.label}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${t.badge}`}>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-5 text-xs text-gray-400 italic">No equipment at this level</div>
      ) : (
        <>
          {/* Column headers */}
          <div className="grid grid-cols-3 gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
            {['Line', 'Equipment Tag', 'Point'].map(h => (
              <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-50 bg-white">
            {visible.map((r, i) => (
              <div key={i} className={`grid grid-cols-3 gap-3 px-4 py-2.5 text-xs ${t.row} transition-colors`}>
                <span className="text-gray-600 truncate">{r.line}</span>
                <span className="font-mono text-gray-800 font-medium truncate">{r.equipmentTag}</span>
                <span className="text-gray-500">{r.point}</span>
              </div>
            ))}
          </div>

          {/* Expand / collapse */}
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-primary hover:bg-blue-50 transition-colors border-t border-gray-100"
            >
              {expanded ? (
                <><ChevronUp size={13} /> Show less</>
              ) : (
                <><ChevronDown size={13} /> Show {rows.length - PREVIEW_COUNT} more</>
              )}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedCompanyId, selectedLocationId } = useScope();

  const [rows, setRows] = useState<FlatAlarm[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastReading, setLastReading] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); setLastReading(null); return; }
    setLoading(true);

    let query = supabase
      .from('measurements')
      .select(`
        alarm_level, measured_at,
        measurement_points (
          name,
          components (
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

    const { data, error } = await query;

    if (!error && data) {
      const flat = (data as unknown as MeasurementRow[])
        .filter(m => m.measurement_points)
        .map(m => ({
          alarmLevel: m.alarm_level,
          measuredAt: m.measured_at,
          line: m.measurement_points.components?.equipment?.sections?.lines?.name ?? '—',
          equipmentTag: m.measurement_points.components?.equipment?.tag ?? '—',
          point: m.measurement_points.name,
        }));

      setRows(flat);
      const latest = flat.reduce<string | null>((acc, r) => (!acc || r.measuredAt > acc ? r.measuredAt : acc), null);
      setLastReading(latest);
    }
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const byLevel = {
    Danger:  rows.filter(r => r.alarmLevel === 'Danger'),
    Warning: rows.filter(r => r.alarmLevel === 'Warning'),
    Alert:   rows.filter(r => r.alarmLevel === 'Alert'),
    Normal:  rows.filter(r => r.alarmLevel === 'Normal'),
  };

  const pieData = (['Normal', 'Alert', 'Warning', 'Danger'] as const)
    .map(l => ({ name: l, value: byLevel[l].length, color: ALARM[l].color }))
    .filter(d => d.value > 0);

  const lineBarData = (() => {
    const map = new Map<string, { line: string; Danger: number; Warning: number; Alert: number }>();
    rows.filter(r => r.alarmLevel !== 'Normal').forEach(r => {
      if (!map.has(r.line)) map.set(r.line, { line: r.line, Danger: 0, Warning: 0, Alert: 0 });
      const e = map.get(r.line)!;
      if (r.alarmLevel in e) (e as Record<string, number>)[r.alarmLevel]++;
    });
    return [...map.values()].sort((a, b) => (b.Danger + b.Warning + b.Alert) - (a.Danger + a.Warning + a.Alert));
  })();

  const noScope = !selectedCompanyId;

  return (
    <div className="space-y-4">
      {/* Title + refresh */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <button onClick={() => fetchData()} className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors" title="Refresh">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {/* Last reading / next visit */}
      <div className="bg-white rounded-xl border border-gray-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar size={15} className="text-gray-400" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Last Reading</p>
            <p className="text-sm font-bold text-gray-900">{loading ? '…' : lastReading ? formatDate(lastReading) : '—'}</p>
          </div>
        </div>
        <div className="h-8 w-px bg-gray-100" />
        <div className="text-right flex items-center gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Next Planned Visit</p>
            <p className="text-sm font-medium text-gray-400">Not scheduled</p>
          </div>
          <Calendar size={15} className="text-gray-300" />
        </div>
      </div>

      {/* No company */}
      {noScope && (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-24 text-gray-400">
          <Building2 size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No company selected</p>
          <p className="text-xs mt-1">Select a company from the header to view dashboard</p>
        </div>
      )}

      {!noScope && loading && (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      )}

      {!noScope && !loading && (
        <>
          {/* Alarm panels + pie */}
          <div className="grid grid-cols-5 gap-4 items-start">
            <div className="col-span-3 space-y-3">
              <AlarmPanel level="Danger"  rows={byLevel.Danger}  />
              <AlarmPanel level="Warning" rows={byLevel.Warning} />
              <AlarmPanel level="Alert"   rows={byLevel.Alert}   />
            </div>

            <div className="col-span-2 bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
              <h2 className="text-sm font-semibold text-gray-800">Alarm Distribution</h2>
              <p className="text-xs text-gray-400 mt-0.5 mb-4">{rows.length} measurement points</p>
              {pieData.length === 0 ? (
                <div className="flex items-center justify-center h-48 text-gray-300 text-sm">No data yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="45%" outerRadius={100} dataKey="value" paddingAngle={2}>
                      {pieData.map(e => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, n: string) => [`${v} points`, n]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}

              {/* Mini counts */}
              <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                {(['Danger', 'Warning', 'Alert', 'Normal'] as const).map(l => (
                  <div key={l} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${ALARM[l].dot}`} />
                    <span className="text-xs text-gray-500 flex-1">{l}</span>
                    <span className="text-xs font-bold text-gray-800">{byLevel[l].length}</span>
                    <div className="w-20 bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full" style={{ width: rows.length ? `${(byLevel[l].length / rows.length) * 100}%` : '0%', backgroundColor: ALARM[l].color }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  );
}
