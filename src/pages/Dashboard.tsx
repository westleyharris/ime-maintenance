import { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, RefreshCw, Loader2, Building2, ChevronDown, ChevronUp, X, CheckCircle2, Crosshair, Wrench } from 'lucide-react';
import { useScope } from '../context/ScopeContext';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAll';
import { AssetHealthModal } from '../components/EquipmentDetail';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MeasurementRow {
  alarm_level: string;
  measured_at: string;
  measurement_point_id: string;
  measurement_points: {
    name: string;
    components: {
      equipment: {
        id: string;
        tag: string;
        status: string | null;
        sections: { uas_name: string; lines: { name: string } };
      };
    };
  };
}

interface FlatAlarm {
  alarmLevel: string;
  measuredAt: string;
  line: string;
  system: string;
  equipmentId: string;
  equipmentTag: string;
  equipmentStatus: string;
  point: string;
}

interface FlatEquipment {
  line: string;
  system: string;
  equipmentId: string;
  equipmentTag: string;
  worstLevel: string;
  pointCounts: Record<string, number>;
  totalPoints: number;
  latestMeasuredAt: string;
}

type ViewMode = 'points' | 'equipment';

// ── Design tokens ─────────────────────────────────────────────────────────────

const ALARM_RANK: Record<string, number> = { Normal: 0, Alert: 1, Warning: 2, Danger: 3 };

const ALARM = {
  Danger:  { dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700 border-red-200',          row: 'hover:bg-red-50/50',    border: 'border-red-200',    bg: 'bg-red-50',    title: 'text-red-700',    label: 'Equipment Under Danger',  color: '#ef4444' },
  Warning: { dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700 border-orange-200', row: 'hover:bg-orange-50/50', border: 'border-orange-200', bg: 'bg-orange-50', title: 'text-orange-700', label: 'Equipment Under Warning', color: '#f97316' },
  Alert:   { dot: 'bg-blue-400',   badge: 'bg-blue-100 text-blue-700 border-blue-200',       row: 'hover:bg-blue-50/50',   border: 'border-blue-200',   bg: 'bg-blue-50',   title: 'text-blue-700',   label: 'Equipment Under Alert',   color: '#60a5fa' },
  Normal:  { dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700 border-green-200',    row: '',                      border: 'border-green-200',  bg: 'bg-green-50',  title: 'text-green-700',  label: 'Normal',                  color: '#22c55e' },
};

const PREVIEW_COUNT = 4;

function formatDate(iso: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

// ── Points alarm panel ────────────────────────────────────────────────────────

function PointsAlarmPanel({ level, rows, onSelect }: { level: 'Danger' | 'Warning' | 'Alert'; rows: FlatAlarm[]; onSelect: (id: string, tag: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const t = ALARM[level];
  const visible = expanded ? rows : rows.slice(0, PREVIEW_COUNT);
  const hasMore = rows.length > PREVIEW_COUNT;

  return (
    <div className={`rounded-xl border ${t.border} overflow-hidden`}>
      <div className={`${t.bg} px-4 py-2.5 flex items-center gap-2.5`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />
        <span className={`text-xs font-bold uppercase tracking-widest flex-1 ${t.title}`}>{t.label}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${t.badge}`}>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-3.5 text-xs text-gray-400 italic bg-white">No equipment at this level</div>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-4 gap-3 px-4 py-1.5 bg-gray-50 border-b border-gray-100">
            {['Line', 'System', 'Equipment Tag', 'Point'].map(h => (
              <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-gray-50 bg-white">
            {visible.map((r, i) => (
              <div key={i}
                onClick={() => r.equipmentId && onSelect(r.equipmentId, r.equipmentTag)}
                className={`px-4 py-2 text-xs ${t.row} transition-colors ${r.equipmentId ? 'cursor-pointer' : ''}`}>
                <div className="sm:hidden flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono font-medium text-gray-800">{r.equipmentTag}</p>
                    <p className="text-gray-500 mt-0.5">{r.point} · {r.system} · {r.line}</p>
                  </div>
                </div>
                <div className="hidden sm:grid grid-cols-4 gap-3">
                  <span className="text-gray-500 truncate">{r.line}</span>
                  <span className="text-gray-500 truncate">{r.system}</span>
                  <span className="font-mono text-gray-800 font-medium truncate">{r.equipmentTag}</span>
                  <span className="text-gray-500 truncate">{r.point}</span>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-primary hover:bg-blue-50 transition-colors border-t border-gray-100 bg-white"
            >
              {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> {rows.length - PREVIEW_COUNT} more</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Equipment alarm panel ─────────────────────────────────────────────────────

function EquipmentAlarmPanel({ level, rows, onSelect }: { level: 'Danger' | 'Warning' | 'Alert'; rows: FlatEquipment[]; onSelect: (id: string, tag: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const t = ALARM[level];
  const visible = expanded ? rows : rows.slice(0, PREVIEW_COUNT);
  const hasMore = rows.length > PREVIEW_COUNT;

  return (
    <div className={`rounded-xl border ${t.border} overflow-hidden`}>
      <div className={`${t.bg} px-4 py-2.5 flex items-center gap-2.5`}>
        <span className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />
        <span className={`text-xs font-bold uppercase tracking-widest flex-1 ${t.title}`}>{t.label}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${t.badge}`}>{rows.length}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-3.5 text-xs text-gray-400 italic bg-white">No equipment at this level</div>
      ) : (
        <>
          <div className="hidden sm:grid grid-cols-[1fr_1.5fr_1.5fr_1.8fr] gap-3 px-4 py-1.5 bg-gray-50 border-b border-gray-100">
            {['Line', 'System', 'Equipment Tag', 'Points in Alarm'].map(h => (
              <span key={h} className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{h}</span>
            ))}
          </div>
          <div className="divide-y divide-gray-50 bg-white">
            {visible.map((r, i) => {
              const alarmPoints = (['Danger', 'Warning', 'Alert'] as const)
                .filter(l => (r.pointCounts[l] ?? 0) > 0)
                .map(l => ({ l, count: r.pointCounts[l] }));
              return (
                <div key={i}
                  onClick={() => r.equipmentId && onSelect(r.equipmentId, r.equipmentTag)}
                  className={`px-4 py-2.5 text-xs ${t.row} transition-colors ${r.equipmentId ? 'cursor-pointer' : ''}`}>
                  <div className="sm:hidden">
                    <p className="font-mono font-medium text-gray-800">{r.equipmentTag}</p>
                    <p className="text-gray-500 mt-0.5">{r.system} · {r.line}</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {alarmPoints.map(({ l, count }) => (
                        <span key={l} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ALARM[l].badge}`}>
                          {count} {l}
                        </span>
                      ))}
                      {(r.pointCounts['Normal'] ?? 0) > 0 && (
                        <span className="text-[10px] text-gray-400">{r.pointCounts['Normal']} Normal</span>
                      )}
                    </div>
                  </div>
                  <div className="hidden sm:grid grid-cols-[1fr_1.5fr_1.5fr_1.8fr] gap-3 items-center">
                    <span className="text-gray-500 truncate">{r.line}</span>
                    <span className="text-gray-500 truncate">{r.system}</span>
                    <span className="font-mono text-gray-800 font-medium truncate">{r.equipmentTag}</span>
                    <div className="flex flex-wrap gap-1 items-center">
                      {alarmPoints.map(({ l, count }) => (
                        <span key={l} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ALARM[l].badge}`}>
                          {count} {l}
                        </span>
                      ))}
                      {(r.pointCounts['Normal'] ?? 0) > 0 && (
                        <span className="text-[10px] text-gray-400">{r.pointCounts['Normal']} nml</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-primary hover:bg-blue-50 transition-colors border-t border-gray-100 bg-white"
            >
              {expanded ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> {rows.length - PREVIEW_COUNT} more</>}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { selectedCompanyId, selectedLocationId, selectedLineId, lines } = useScope();

  const [rows, setRows]               = useState<FlatAlarm[]>([]);
  const [loading, setLoading]         = useState(false);
  const [lastReading, setLastReading] = useState<string | null>(null);
  const [nextVisit, setNextVisit]     = useState<string | null>(null);
  const [showPicker, setShowPicker]   = useState(false);
  const [savingVisit, setSavingVisit] = useState(false);
  const [viewMode, setViewMode]       = useState<ViewMode>('equipment');
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; tag: string } | null>(null);
  const pickerRef                     = useRef<HTMLDivElement>(null);

  const openAsset = (id: string, tag: string) => setSelectedAsset({ id, tag });

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  useEffect(() => {
    if (!selectedLocationId) { setNextVisit(null); return; }
    supabase.from('locations').select('next_visit_date').eq('id', selectedLocationId).single()
      .then(({ data }) => setNextVisit(data?.next_visit_date ?? null));
  }, [selectedLocationId]);

  const handleSetNextVisit = async (date: string | null) => {
    setShowPicker(false);
    if (!selectedLocationId) return;
    setSavingVisit(true);
    await supabase.from('locations').update({ next_visit_date: date }).eq('id', selectedLocationId);
    setNextVisit(date);
    setSavingVisit(false);
  };

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); setLastReading(null); return; }
    setLoading(true);

    const { rows: data, error } = await fetchAllRows<MeasurementRow>((from, to) => {
      let q = supabase
        .from('measurements')
        .select(`
          alarm_level, measured_at, measurement_point_id,
          measurement_points (
            name,
            components (
              equipment (
                id, tag, status,
                sections ( uas_name, lines ( name ) )
              )
            )
          )
        `)
        .eq('company_id', selectedCompanyId)
        .order('measured_at', { ascending: false })
        .range(from, to);
      if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
      return q as unknown as PromiseLike<{ data: MeasurementRow[] | null; error: unknown }>;
    });

    if (!error) {
      // Rows arrive newest-first; keep only the latest reading per point.
      const seen = new Set<string>();
      const flat = data
        .filter(m => m.measurement_points && !seen.has(m.measurement_point_id) && seen.add(m.measurement_point_id))
        .map(m => ({
          alarmLevel:      m.alarm_level,
          measuredAt:      m.measured_at,
          line:            m.measurement_points.components?.equipment?.sections?.lines?.name ?? '—',
          system:          m.measurement_points.components?.equipment?.sections?.uas_name ?? '—',
          equipmentId:     m.measurement_points.components?.equipment?.id ?? '',
          equipmentTag:    m.measurement_points.components?.equipment?.tag ?? '—',
          equipmentStatus: m.measurement_points.components?.equipment?.status ?? 'active',
          point:           m.measurement_points.name,
        }));

      setRows(flat);
      const latest = flat.reduce<string | null>((acc, r) => (!acc || r.measuredAt > acc ? r.measuredAt : acc), null);
      setLastReading(latest);
    }
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const selectedLineName = selectedLineId
    ? (lines.find(l => l.id === selectedLineId)?.name ?? null)
    : null;

  const activeRows = rows.filter(r =>
    r.equipmentStatus !== 'inactive' &&
    (!selectedLineName || r.line === selectedLineName)
  );

  // Points-level grouping
  const byLevel = {
    Danger:  activeRows.filter(r => r.alarmLevel === 'Danger'),
    Warning: activeRows.filter(r => r.alarmLevel === 'Warning'),
    Alert:   activeRows.filter(r => r.alarmLevel === 'Alert'),
    Normal:  activeRows.filter(r => r.alarmLevel === 'Normal'),
  };

  // Equipment-level grouping (worst alarm per equipment)
  const equipmentMap = new Map<string, FlatEquipment>();
  for (const r of activeRows) {
    const existing = equipmentMap.get(r.equipmentTag);
    if (!existing) {
      equipmentMap.set(r.equipmentTag, {
        line: r.line,
        system: r.system,
        equipmentId: r.equipmentId,
        equipmentTag: r.equipmentTag,
        worstLevel: r.alarmLevel,
        pointCounts: { [r.alarmLevel]: 1 },
        totalPoints: 1,
        latestMeasuredAt: r.measuredAt,
      });
    } else {
      existing.pointCounts[r.alarmLevel] = (existing.pointCounts[r.alarmLevel] ?? 0) + 1;
      existing.totalPoints++;
      if (ALARM_RANK[r.alarmLevel] > ALARM_RANK[existing.worstLevel]) existing.worstLevel = r.alarmLevel;
      if (r.measuredAt > existing.latestMeasuredAt) existing.latestMeasuredAt = r.measuredAt;
    }
  }
  const equipmentRows = Array.from(equipmentMap.values());

  const byLevelEquipment = {
    Danger:  equipmentRows.filter(e => e.worstLevel === 'Danger'),
    Warning: equipmentRows.filter(e => e.worstLevel === 'Warning'),
    Alert:   equipmentRows.filter(e => e.worstLevel === 'Alert'),
    Normal:  equipmentRows.filter(e => e.worstLevel === 'Normal'),
  };

  // Pie data switches with view mode
  const pieSource = viewMode === 'points' ? byLevel : byLevelEquipment;
  const pieTotal  = viewMode === 'points' ? activeRows.length : equipmentRows.length;
  const pieData = (['Normal', 'Alert', 'Warning', 'Danger'] as const)
    .map(l => ({ name: l, value: pieSource[l].length, color: ALARM[l].color }))
    .filter(d => d.value > 0);

  // Route compliance (90-day window, always equipment-based)
  const COMPLIANCE_MS = 90 * 24 * 60 * 60 * 1000;
  const latestByEquipment = new Map<string, number>();
  activeRows.forEach(r => {
    const t = new Date(r.measuredAt).getTime();
    if ((latestByEquipment.get(r.equipmentTag) ?? 0) < t) latestByEquipment.set(r.equipmentTag, t);
  });
  const totalMonitored    = latestByEquipment.size;
  const compliantCount    = Array.from(latestByEquipment.values()).filter(t => Date.now() - t <= COMPLIANCE_MS).length;
  const nonCompliantCount = totalMonitored - compliantCount;
  const compliancePct     = totalMonitored > 0 ? Math.round((compliantCount / totalMonitored) * 100) : 0;
  const compliantPct      = totalMonitored > 0 ? (compliantCount / totalMonitored) * 100 : 0;

  const noScope = !selectedCompanyId;
  const hasData = activeRows.length > 0;

  return (
    <div className="space-y-4">

      {/* ── Title row ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

        <div className="flex items-center gap-2 ml-auto flex-wrap">

          {/* View mode toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('points')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                viewMode === 'points'
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Crosshair size={12} />
              Points
            </button>
            <button
              onClick={() => setViewMode('equipment')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                viewMode === 'equipment'
                  ? 'bg-white text-primary shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Wrench size={12} />
              Equipment
            </button>
          </div>

          {/* Last Reading badge */}
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-sm">
            <Calendar size={13} className="text-gray-400 shrink-0" />
            <div className="leading-none">
              <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Last Reading</p>
              <p className="text-xs font-bold text-gray-800 mt-0.5">
                {loading ? '…' : lastReading ? formatDate(lastReading) : '—'}
              </p>
            </div>
          </div>

          {/* Next Visit badge */}
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => selectedLocationId && setShowPicker(p => !p)}
              title={selectedLocationId ? 'Set next visit date' : 'Select a location first'}
              className={`flex items-center gap-2 bg-white border rounded-lg px-3 py-2 shadow-sm transition-colors
                ${showPicker ? 'border-primary/50 ring-2 ring-primary/20' : 'border-gray-200'}
                ${selectedLocationId ? 'hover:border-gray-300 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
            >
              <Calendar size={13} className={nextVisit ? 'text-primary shrink-0' : 'text-gray-400 shrink-0'} />
              <div className="leading-none text-left">
                <p className="text-[9px] font-bold uppercase tracking-widest text-gray-400">Next Visit</p>
                <p className={`text-xs font-bold mt-0.5 ${nextVisit ? 'text-primary' : 'text-gray-400'}`}>
                  {savingVisit ? 'Saving…' : nextVisit ? formatDate(nextVisit) : 'Not set'}
                </p>
              </div>
            </button>

            {showPicker && (
              <div className="absolute right-0 top-full mt-2 bg-white rounded-xl border border-gray-200 shadow-lg p-4 z-50 min-w-[200px]">
                <p className="text-xs font-semibold text-gray-500 mb-2">Set next visit date</p>
                <input
                  type="date"
                  defaultValue={nextVisit ?? ''}
                  onChange={e => e.target.value && handleSetNextVisit(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
                  autoFocus
                />
                {nextVisit && (
                  <button
                    onClick={() => handleSetNextVisit(null)}
                    className="mt-2 flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    <X size={11} /> Clear date
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Refresh */}
          <button
            onClick={() => fetchData()}
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors bg-white shadow-sm"
            title="Refresh"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      {/* ── No company selected ────────────────────────────────────── */}
      {noScope && (
        <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-24 text-gray-400">
          <Building2 size={40} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No company selected</p>
          <p className="text-xs mt-1">Select a company from the header to view the dashboard</p>
        </div>
      )}

      {!noScope && loading && (
        <div className="flex justify-center py-24">
          <Loader2 size={28} className="animate-spin text-gray-300" />
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────────────── */}
      {!noScope && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-start">

          {/* ── Left column: charts ─────────────────────────────────── */}
          <div className="space-y-6 py-1">

            {/* Alarm Distribution */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Alarm Distribution</h2>
              <p className="text-xs text-gray-400 mt-0.5 mb-3">
                {viewMode === 'points'
                  ? `${activeRows.length} active points`
                  : `${equipmentRows.length} equipment`
                }
                {selectedLineName ? ` · ${selectedLineName}` : ''}
              </p>

              {!hasData ? (
                <div className="flex items-center justify-center h-48 text-gray-300 text-sm">No data yet</div>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="shrink-0">
                    <PieChart width={280} height={280}>
                      <Pie data={pieData} cx="50%" cy="50%" outerRadius={132} dataKey="value" paddingAngle={2}>
                        {pieData.map(e => <Cell key={e.name} fill={e.color} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v) => [`${v} ${viewMode === 'points' ? 'points' : 'equipment'}`]}
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                      />
                    </PieChart>
                  </div>

                  <div className="flex-1 space-y-3 min-w-0">
                    {(['Danger', 'Warning', 'Alert', 'Normal'] as const).map(l => (
                      <div key={l} className="flex items-center gap-2 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ALARM[l].dot}`} />
                        <span className="text-xs text-gray-600 w-12 shrink-0">{l}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-2.5 min-w-0">
                          <div
                            className="h-2.5 rounded-full transition-all"
                            style={{
                              width: pieTotal ? `${(pieSource[l].length / pieTotal) * 100}%` : '0%',
                              backgroundColor: ALARM[l].color,
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-gray-800 w-7 text-right shrink-0">{pieSource[l].length}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200" />

            {/* Route Compliance */}
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Route Compliance</h2>
              <p className="text-xs text-gray-400 mt-0.5">Measured within last 90 days</p>

              {totalMonitored === 0 ? (
                <div className="flex items-center justify-center h-24 text-gray-300 text-sm">No data yet</div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-5xl font-black leading-none ${compliancePct >= 80 ? 'text-green-600' : compliancePct >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
                      {compliancePct}%
                    </span>
                    <span className="text-base font-semibold text-gray-500">Compliant</span>
                    {compliancePct === 100 && <CheckCircle2 size={18} className="text-green-500 ml-1" />}
                  </div>

                  <div className="w-full h-5 rounded-full bg-gray-200 overflow-hidden flex">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${compliantPct}%` }} />
                    <div className="h-full bg-red-400 transition-all"   style={{ width: `${100 - compliantPct}%` }} />
                  </div>

                  <div className="flex items-center gap-5 text-xs text-gray-500 mt-1">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
                      compliant — <span className="font-bold text-gray-800">{compliantCount}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
                      overdue — <span className="font-bold text-gray-800">{nonCompliantCount}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

          </div>

          {/* ── Right column: alarm panels ───────────────────────── */}
          <div className="space-y-3">
            {!hasData ? (
              <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-24 text-gray-400">
                <p className="text-sm font-medium">No measurements yet</p>
                <p className="text-xs mt-1">Import data from the Ultrasound page to populate the dashboard</p>
              </div>
            ) : viewMode === 'points' ? (
              <>
                <PointsAlarmPanel   level="Danger"  rows={byLevel.Danger}  onSelect={openAsset} />
                <PointsAlarmPanel   level="Warning" rows={byLevel.Warning} onSelect={openAsset} />
                <PointsAlarmPanel   level="Alert"   rows={byLevel.Alert}   onSelect={openAsset} />
              </>
            ) : (
              <>
                <EquipmentAlarmPanel level="Danger"  rows={byLevelEquipment.Danger}  onSelect={openAsset} />
                <EquipmentAlarmPanel level="Warning" rows={byLevelEquipment.Warning} onSelect={openAsset} />
                <EquipmentAlarmPanel level="Alert"   rows={byLevelEquipment.Alert}   onSelect={openAsset} />
              </>
            )}
          </div>

        </div>
      )}

      {selectedAsset && (
        <AssetHealthModal
          equipmentId={selectedAsset.id}
          equipmentTag={selectedAsset.tag}
          onClose={() => setSelectedAsset(null)}
        />
      )}
    </div>
  );
}
