import { useState, useEffect, useRef, useCallback } from 'react';
import { Waves, Upload, Loader2, CheckCircle, AlertTriangle, RefreshCw, Building2, X, TrendingUp } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useScope } from '../context/ScopeContext';
import { importUASData, type ImportResult } from '../utils/uasImporter';
import { fetchAllRows } from '../lib/fetchAll';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';

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
    id: string;
    name: string;
    sensor_model: string | null;
    components: {
      name: string;
      equipment: {
        id: string;
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
  measurementPointId: string;
  location: string;
  line: string;
  section: string;
  equipmentId: string;
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
  deltaRms: number | null;
  deltaMaxRms: number | null;
  deltaPeak: number | null;
  deltaCrest: number | null;
}

interface EquipmentGroup {
  id: string;
  tag: string;
  line: string;
  section: string;
  worstAlarm: string;
  worstRms: number;
  points: FlatRow[];
}

function flatten(m: MeasurementRow): FlatRow | null {
  const mp = m.measurement_points;
  if (!mp) return null;
  const comp = mp.components;
  if (!comp) return null;
  const eq = comp.equipment;
  if (!eq) return null;
  const sec = eq.sections;
  if (!sec) return null;
  return {
    id: m.id,
    measurementPointId: mp.id,
    location: sec.lines?.locations?.name ?? '—',
    line: sec.lines?.name ?? '—',
    section: sec.uas_name,
    equipmentId: eq.id,
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
    deltaRms: null,
    deltaMaxRms: null,
    deltaPeak: null,
    deltaCrest: null,
  };
}

// ── Alarm config ──────────────────────────────────────────────────────────────

const ALARM_RANK: Record<string, number> = { Normal: 0, Alert: 1, Warning: 2, Danger: 3 };

const ALARM = {
  Danger:  { bg: 'bg-red-50',    border: 'border-red-500',    badge: 'bg-red-100 text-red-700',    bar: 'bg-red-500',    dot: 'bg-red-500',    text: 'text-red-600'    },
  Warning: { bg: 'bg-orange-50', border: 'border-orange-500', badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', text: 'text-orange-600' },
  Alert:   { bg: 'bg-blue-50',   border: 'border-blue-400',   badge: 'bg-blue-100 text-blue-700',   bar: 'bg-blue-400',   dot: 'bg-blue-400',   text: 'text-blue-600'   },
  Normal:  { bg: 'bg-white',     border: 'border-green-400',  badge: 'bg-green-100 text-green-700',  bar: 'bg-green-400',  dot: 'bg-green-500',  text: 'text-green-600'  },
};
const A = (level: string) => ALARM[level as keyof typeof ALARM] ?? ALARM.Normal;

function fmt(n: number | null) { return n == null ? '—' : n.toFixed(2); }

// Up = worse (red), down = better (green), relative to the previous reading.
function DeltaArrow({ d }: { d: number | null }) {
  if (d == null) return null;
  return (
    <span className={`text-[10px] font-semibold ${d > 0 ? 'text-red-500' : d < 0 ? 'text-green-600' : 'text-gray-400'}`}>
      {d > 0 ? '▲' : d < 0 ? '▼' : '—'}{Math.abs(d).toFixed(2)}
    </span>
  );
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Group rows by equipment ───────────────────────────────────────────────────

function groupByEquipment(rows: FlatRow[]): EquipmentGroup[] {
  // Key on the equipment id, NOT the tag — the same tag can exist on several
  // lines (e.g. an M101 on both L1 and L3 Conveyors) and must not be merged.
  const map = new Map<string, EquipmentGroup>();
  for (const r of rows) {
    if (!map.has(r.equipmentId)) {
      map.set(r.equipmentId, { id: r.equipmentId, tag: r.equipmentTag, line: r.line, section: r.section, worstAlarm: 'Normal', worstRms: 0, points: [] });
    }
    const g = map.get(r.equipmentId)!;
    g.points.push(r);
    if (ALARM_RANK[r.alarmLevel] > ALARM_RANK[g.worstAlarm]) g.worstAlarm = r.alarmLevel;
    if ((r.overallRms ?? 0) > g.worstRms) g.worstRms = r.overallRms ?? 0;
  }
  return Array.from(map.values()).sort((a, b) => ALARM_RANK[b.worstAlarm] - ALARM_RANK[a.worstAlarm] || a.tag.localeCompare(b.tag));
}

// ── Trend modal ───────────────────────────────────────────────────────────────

type Metric = 'overallRms' | 'maxRms' | 'peak' | 'crestFactor';

interface TrendEntry {
  date: string;
  fullDate: string;
  overallRms: number | null;
  maxRms: number | null;
  peak: number | null;
  crestFactor: number | null;
  alarmLevel: string;
}

const METRIC_OPTIONS: { key: Metric; label: string; color: string }[] = [
  { key: 'overallRms',   label: 'Overall RMS',  color: '#3b82f6' },
  { key: 'maxRms',       label: 'Max RMS',       color: '#8b5cf6' },
  { key: 'peak',         label: 'Peak',          color: '#f97316' },
  { key: 'crestFactor',  label: 'Crest Factor',  color: '#06b6d4' },
];

const ALARM_DOT: Record<string, string> = {
  Danger: '#ef4444', Warning: '#f97316', Alert: '#60a5fa', Normal: '#22c55e',
};

// Alarm cutoffs are driven by crest factor (the alarm_level generated column):
// <10 Normal · 10–12 Alert · 12–14 Warning · ≥14 Danger. Shown as dotted
// reference lines on the Crest Factor trend so users see where a point sits.
const CF_THRESHOLDS = [
  { y: 10, label: 'Alert',   color: '#60a5fa' },
  { y: 12, label: 'Warning', color: '#f97316' },
  { y: 14, label: 'Danger',  color: '#ef4444' },
];

function CustomDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: TrendEntry }) {
  if (cx == null || cy == null || !payload) return null;
  return (
    <circle cx={cx} cy={cy} r={4}
      fill={ALARM_DOT[payload.alarmLevel] ?? '#22c55e'}
      stroke="white" strokeWidth={1.5} />
  );
}

// ── Signal analysis (FLAC waveform + UAS3 FFT) ──────────────────────────────────

function SignalView({ waveformPath, fftPath, sampleRate }: {
  waveformPath: string | null; fftPath: string | null; sampleRate: number | null;
}) {
  const [loading, setLoading] = useState(true);
  const [wave, setWave]       = useState<{ x: number; y: number }[] | null>(null);
  const [spec, setSpec]       = useState<{ f: number; m: number }[] | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [err, setErr]         = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null); setWave(null); setSpec(null); setAudioUrl(null);
      try {
        if (waveformPath) {
          const { data: s } = await supabase.storage.from('uas-signals').createSignedUrl(waveformPath, 3600);
          if (s?.signedUrl && !cancelled) {
            setAudioUrl(s.signedUrl);
            const ab = await (await fetch(s.signedUrl)).arrayBuffer();
            const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
            const ac = new AC();
            const audio = await ac.decodeAudioData(ab.slice(0));
            const ch = audio.getChannelData(0);
            const N = 900; const block = Math.max(1, Math.floor(ch.length / N));
            const w: { x: number; y: number }[] = [];
            for (let i = 0; i < N; i++) { let mx = 0; for (let j = 0; j < block; j++) { const v = Math.abs(ch[i * block + j] || 0); if (v > mx) mx = v; } w.push({ x: i, y: mx }); }
            ac.close();
            if (!cancelled) setWave(w);
          }
        }
        if (fftPath) {
          const { data: s } = await supabase.storage.from('uas-signals').createSignedUrl(fftPath, 3600);
          if (s?.signedUrl && !cancelled) {
            const ab = await (await fetch(s.signedUrl)).arrayBuffer();
            const arr = new Float32Array(ab);
            const n = arr.length; const N = 1000; const block = Math.max(1, Math.floor(n / N));
            const nyq = (sampleRate || 32000) / 2;
            const sp: { f: number; m: number }[] = [];
            for (let i = 0; i < N; i++) { let mx = 0; for (let j = 0; j < block; j++) { const v = Math.abs(arr[i * block + j] || 0); if (v > mx) mx = v; } sp.push({ f: Math.round((i / (N - 1)) * nyq), m: mx }); }
            if (!cancelled) setSpec(sp);
          }
        }
      } catch { if (!cancelled) setErr('Could not load signal'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [waveformPath, fftPath, sampleRate]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-gray-300" /></div>;
  if (err)     return <p className="text-xs text-gray-400">{err}</p>;

  return (
    <div className="space-y-4">
      {spec && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Spectrum (FFT)</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={spec} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
              <XAxis dataKey="f" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} width={36} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} formatter={(v) => [Number(v).toFixed(2), 'mag']} labelFormatter={(l) => `${l} Hz`} />
              <Line type="monotone" dataKey="m" stroke="#06b6d4" strokeWidth={1.2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {wave && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Waveform (envelope)</p>
          <ResponsiveContainer width="100%" height={110}>
            <LineChart data={wave} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
              <XAxis dataKey="x" hide />
              <YAxis hide domain={[0, 'dataMax']} />
              <Line type="monotone" dataKey="y" stroke="#8b5cf6" strokeWidth={1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {audioUrl && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Listen</p>
          <audio src={audioUrl} controls className="w-full" />
        </div>
      )}
    </div>
  );
}

function TrendModal({ point, equipmentTag, onClose }: {
  point: { id: string; name: string };
  equipmentTag: string;
  onClose: () => void;
}) {
  const [data, setData]       = useState<TrendEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric]   = useState<Metric>('overallRms');
  const [sig, setSig]         = useState<{ waveformPath: string; fftPath: string | null; sampleRate: number | null } | null>(null);
  const [bearingRpm, setBearingRpm] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from('measurements')
      .select('overall_rms, max_rms, peak, crest_factor, alarm_level, measured_at, waveform_path, fft_path, sample_rate')
      .eq('measurement_point_id', point.id)
      .order('measured_at', { ascending: true })
      .then(({ data: rows }) => {
        const rs = (rows ?? []) as Array<Record<string, unknown>>;
        setData(rs.map(m => ({
          date:       new Date(m.measured_at as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
          fullDate:   m.measured_at as string,
          overallRms: m.overall_rms as number | null,
          maxRms:     m.max_rms as number | null,
          peak:       m.peak as number | null,
          crestFactor: m.crest_factor as number | null,
          alarmLevel: m.alarm_level as string,
        })));
        const withSig = rs.filter(m => m.waveform_path);
        const s = withSig.length ? withSig[withSig.length - 1] : null;
        setSig(s ? { waveformPath: s.waveform_path as string, fftPath: (s.fft_path as string) ?? null, sampleRate: (s.sample_rate as number) ?? null } : null);
        setLoading(false);
      });
    supabase.from('measurement_points').select('bearing_rotating_speed').eq('id', point.id).single()
      .then(({ data: p }) => setBearingRpm((p?.bearing_rotating_speed as number) ?? null));
  }, [point.id]);

  const cfg = METRIC_OPTIONS.find(m => m.key === metric)!;
  const hasEnough = data.length >= 2;

  const latest = data[data.length - 1];
  const prev   = data[data.length - 2];
  const delta  = latest && prev && latest[metric] != null && prev[metric] != null
    ? (latest[metric] as number) - (prev[metric] as number)
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{equipmentTag}</p>
            <h2 className="text-base font-bold text-gray-900 mt-0.5">{point.name}</h2>
            {bearingRpm != null && <p className="text-xs text-gray-400 mt-0.5">Bearing rotating speed: <span className="font-semibold text-gray-600">{bearingRpm}</span> RPM</p>}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Metric selector */}
          <div className="flex items-center gap-2 flex-wrap">
            {METRIC_OPTIONS.map(m => (
              <button key={m.key} onClick={() => setMetric(m.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  metric === m.key ? 'text-white shadow-sm' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
                style={metric === m.key ? { backgroundColor: m.color } : undefined}>
                {m.label}
              </button>
            ))}
            {delta != null && (
              <span className={`ml-auto text-xs font-semibold ${delta > 0 ? 'text-red-500' : 'text-green-600'}`}>
                {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(3)} vs prev
              </span>
            )}
          </div>

          {/* Chart */}
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
          ) : !hasEnough ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <TrendingUp size={36} className="mb-3 opacity-30" />
              <p className="text-sm font-medium">Not enough data for a trend</p>
              <p className="text-xs mt-1 text-gray-300">
                {data.length === 0 ? 'No measurements found' : 'Need at least 2 measurements to plot a trend'}
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={48}
                  tickFormatter={v => v.toFixed(2)}
                  // Stretch the axis past the Danger cutoff so the threshold
                  // lines are always visible, even when readings sit low.
                  domain={metric === 'crestFactor' ? [0, (dataMax: number) => Math.max(15, Math.ceil(dataMax * 1.1))] : undefined} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e5e7eb', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}
                  formatter={(v) => [Number(v).toFixed(3), cfg.label]}
                  labelFormatter={(_: unknown, payload) => {
                    if (!payload?.length) return '';
                    const d = payload[0].payload as TrendEntry;
                    const lvl = d.alarmLevel;
                    return `${new Date(d.fullDate).toLocaleDateString('en-US', { dateStyle: 'medium' })} · ${lvl}`;
                  }}
                />
                <ReferenceLine y={0} stroke="#e5e7eb" />
                {metric === 'crestFactor' && CF_THRESHOLDS.map(t => (
                  <ReferenceLine key={t.label} y={t.y} stroke={t.color} strokeDasharray="6 4" strokeWidth={1.2}
                    label={{ value: `${t.label} ≥ ${t.y}`, position: 'insideRight', fontSize: 10, fill: t.color, dy: -7 }} />
                ))}
                <Line
                  type="monotone"
                  dataKey={metric}
                  stroke={cfg.color}
                  strokeWidth={2}
                  dot={<CustomDot />}
                  activeDot={{ r: 6, stroke: 'white', strokeWidth: 2 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          {/* Reading count */}
          {!loading && (
            <p className="text-xs text-gray-300 text-right">
              {data.length} measurement{data.length !== 1 ? 's' : ''} · dots colored by alarm level
            </p>
          )}

          {/* Signal analysis */}
          {!loading && sig && (
            <div className="border-t border-gray-100 pt-4">
              <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1.5">
                <Waves size={15} className="text-primary" /> Signal analysis
                <span className="text-xs font-normal text-gray-400">· latest reading</span>
              </p>
              <SignalView waveformPath={sig.waveformPath} fftPath={sig.fftPath} sampleRate={sig.sampleRate} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Ultrasound() {
  const { selectedCompanyId, selectedLocationId } = useScope();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<FlatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [filterAlarm, setFilterAlarm] = useState('');
  const [filterLine, setFilterLine] = useState('');
  const [filterSection, setFilterSection] = useState('');
  const [search, setSearch] = useState('');
  const [selectedPoint, setSelectedPoint] = useState<{ id: string; name: string; equipmentTag: string } | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); setLoading(false); return; }
    setLoading(true);

    // Page through ALL measurements — PostgREST caps a single response at 1000
    // rows, and a location can have more than that, so without paging the dedup
    // below would only see a truncated set and could miss the latest reading.
    const { rows: all, error } = await fetchAllRows<MeasurementRow>((from, to) => {
      let q = supabase
        .from('measurements')
        .select(`
          id, overall_rms, max_rms, peak, crest_factor, alarm_level, measured_at,
          measurement_points (
            id, name, sensor_model,
            components (
              name,
              equipment (
                id, tag,
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
        .order('measured_at', { ascending: false })
        .range(from, to);
      if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
      return q as unknown as PromiseLike<{ data: MeasurementRow[] | null; error: unknown }>;
    });

    if (!error) {
      const allFlat = all.map(flatten).filter((r): r is FlatRow => r !== null);

      // Group by measurement point, sort each group newest→oldest, compute delta
      const byPoint = new Map<string, FlatRow[]>();
      for (const r of allFlat) {
        if (!byPoint.has(r.measurementPointId)) byPoint.set(r.measurementPointId, []);
        byPoint.get(r.measurementPointId)!.push(r);
      }
      const delta = (a: number | null, b: number | null | undefined) =>
        (a != null && b != null) ? a - b : null;
      const deduped: FlatRow[] = [];
      for (const pts of byPoint.values()) {
        pts.sort((a, b) => b.measuredAt.localeCompare(a.measuredAt));
        const latest = pts[0];
        const prev   = pts[1];
        deduped.push({
          ...latest,
          deltaRms:    delta(latest.overallRms, prev?.overallRms),
          deltaMaxRms: delta(latest.maxRms, prev?.maxRms),
          deltaPeak:   delta(latest.peak, prev?.peak),
          deltaCrest:  delta(latest.crestFactor, prev?.crestFactor),
        });
      }
      setRows(deduped);
    }
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

  // Line/system dropdowns cascade off each other: systems are scoped to the
  // selected line, and lines are scoped to the selected system.
  const lines    = [...new Set(rows.filter(r => !filterSection || r.section === filterSection).map(r => r.line))].sort();
  const sections = [...new Set(rows.filter(r => !filterLine    || r.line    === filterLine).map(r => r.section))].sort();

  // Line / system / search scope — everything except the alarm filter.
  const scoped = rows.filter(r => {
    if (filterLine    && r.line       !== filterLine)    return false;
    if (filterSection && r.section    !== filterSection) return false;
    if (search) {
      const q = search.toLowerCase();
      return r.equipmentTag.toLowerCase().includes(q) || r.component.toLowerCase().includes(q) || r.point.toLowerCase().includes(q);
    }
    return true;
  });

  const filtered = scoped.filter(r => !filterAlarm || r.alarmLevel === filterAlarm);

  const groups = groupByEquipment(filtered);

  // Counts follow the line/system/search scope so they match the list below, but
  // deliberately ignore the alarm filter — these cards ARE the alarm filter, and
  // folding it in would zero the other three and strand the user on one level.
  const counts = {
    Danger:  scoped.filter(r => r.alarmLevel === 'Danger').length,
    Warning: scoped.filter(r => r.alarmLevel === 'Warning').length,
    Alert:   scoped.filter(r => r.alarmLevel === 'Alert').length,
    Normal:  scoped.filter(r => r.alarmLevel === 'Normal').length,
  };

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
          <button disabled={importing || true}
            title="Excel import is disabled — measurements now sync live from UAS3"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-200 text-gray-400 text-sm font-semibold cursor-not-allowed">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Search equipment, component, point…" value={search} onChange={e => setSearch(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-primary/30" />
            <select value={filterLine} onChange={e => { setFilterLine(e.target.value); setFilterSection(''); }}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
              <option value="">All Lines</option>
              {lines.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <select value={filterSection} onChange={e => setFilterSection(e.target.value)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
              <option value="">All Systems</option>
              {sections.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {(filterAlarm || filterLine || filterSection || search) && (
              <button onClick={() => { setFilterAlarm(''); setFilterLine(''); setFilterSection(''); setSearch(''); }} className="text-xs text-primary hover:underline">
                Clear filters
              </button>
            )}
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <span className="flex items-center gap-0.5">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  <span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />
                  <span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />
                  <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                </span>
                Sorted by severity
              </span>
              <span className="text-xs text-gray-300">·</span>
              <span className="text-xs text-gray-400">{groups.length} equipment · {filtered.length} points</span>
            </div>
          </div>

          {/* Equipment cards */}
          <div className="space-y-3">
            {groups.map(g => {
              const cfg = A(g.worstAlarm);
              return (
                <div key={g.id} className={`rounded-xl border border-gray-200 border-l-4 overflow-hidden ${cfg.border.replace('border-', 'border-l-')}`}>
                  {/* Equipment header */}
                  {/* Header stacks on a phone — tag + line + section + count + badge
                      never fit one 338px row. */}
                  <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 px-4 py-3 ${cfg.bg}`}>
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                      <p className="text-sm font-bold text-gray-900 font-mono shrink-0">{g.tag}</p>
                      <span className="text-xs text-gray-400 truncate">{g.line}</span>
                      <span className="text-xs text-gray-300 hidden sm:inline">·</span>
                      <span className="text-xs text-gray-400 max-w-[200px] truncate hidden sm:inline">{g.section}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-gray-400 truncate sm:hidden">{g.section}</span>
                      <span className="text-xs text-gray-400 shrink-0 ml-auto sm:ml-0">{g.points.length} point{g.points.length !== 1 ? 's' : ''}</span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
                        {g.worstAlarm}
                      </span>
                    </div>
                  </div>

                  {/* Measurement points */}
                  <div className="divide-y divide-gray-50">
                    {g.points.map(r => {
                      const pcfg = A(r.alarmLevel);
                      return (
                        <div key={r.id}
                          className="flex items-center gap-3 md:gap-4 px-4 py-2.5 bg-white hover:bg-blue-50/40 cursor-pointer transition-colors"
                          onClick={() => setSelectedPoint({ id: r.measurementPointId, name: r.point, equipmentTag: g.tag })}>
                          {/* Point name + component */}
                          <div className="w-44 shrink-0">
                            <p className="text-xs font-semibold text-gray-700 truncate">{r.point}</p>
                            <p className="text-[10px] text-gray-400 truncate">{r.component}</p>
                          </div>

                          {/* Crest Factor + delta (primary — drives the alarm level) */}
                          <div className="shrink-0 text-right">
                            <p className="text-[10px] text-gray-400 uppercase tracking-wide">CF</p>
                            <div className="flex items-center gap-1.5 justify-end">
                              <p className="text-xs font-mono font-semibold text-gray-700">{fmt(r.crestFactor)}</p>
                              <DeltaArrow d={r.deltaCrest} />
                            </div>
                          </div>

                          {/* Other metrics */}
                          <div className="hidden lg:flex items-center gap-4 flex-1 shrink-0 text-xs text-gray-500 font-mono">
                            <span title="Overall RMS" className="inline-flex items-center gap-1"><span className="text-gray-300">rms</span>{fmt(r.overallRms)}<DeltaArrow d={r.deltaRms} /></span>
                            <span title="Max RMS" className="inline-flex items-center gap-1"><span className="text-gray-300">max</span>{fmt(r.maxRms)}<DeltaArrow d={r.deltaMaxRms} /></span>
                            <span title="Peak" className="inline-flex items-center gap-1"><span className="text-gray-300">pk</span>{fmt(r.peak)}<DeltaArrow d={r.deltaPeak} /></span>
                          </div>

                          {/* Alarm badge */}
                          <div className="shrink-0 w-20 text-right">
                            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${pcfg.badge}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${pcfg.dot}`} />
                              {r.alarmLevel}
                            </span>
                          </div>

                          {/* Date */}
                          <div className="shrink-0 hidden xl:flex items-center gap-2 w-28 justify-end">
                            <span className="text-[10px] text-gray-300">{fmtDate(r.measuredAt)}</span>
                            <TrendingUp size={12} className="text-gray-200" />
                          </div>
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

      {selectedPoint && (
        <TrendModal
          point={{ id: selectedPoint.id, name: selectedPoint.name }}
          equipmentTag={selectedPoint.equipmentTag}
          onClose={() => setSelectedPoint(null)}
        />
      )}
    </div>
  );
}
