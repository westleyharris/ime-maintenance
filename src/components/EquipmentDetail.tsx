import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, QrCode, ClipboardList, Loader2, Wrench, ImagePlus } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

interface EquipmentInfo {
  id: string;
  tag: string;
  display_name: string | null;
  asset_type: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  installation_date: string | null;
  status: string | null;
  location_notes: string | null;
  image_url: string | null;
  spec_rated_power: string | null;
  spec_rated_speed: string | null;
  spec_flow_rate: string | null;
  spec_pressure: string | null;
  spec_temperature: string | null;
  spec_weight: string | null;
  sections: { uas_name: string; lines: { name: string } } | null;
}

interface Measurement {
  id: string;
  overall_rms: number | null;
  max_rms: number | null;
  peak: number | null;
  crest_factor: number | null;
  alarm_level: string;
  measured_at: string;
}

interface MeasurementPoint {
  id: string;
  name: string;
  measurements: Measurement[];
}

interface ComponentData {
  id: string;
  name: string;
  measurement_points: MeasurementPoint[];
}

// Derived finding from a measurement
interface DerivedFinding {
  id: string;
  alarmLevel: string;
  pointName: string;
  componentName: string;
  overallRms: number | null;
  peak: number | null;
  measuredAt: string;
}

interface Props {
  equipmentId: string;
  equipmentTag: string;
  onBack: () => void;
}

// ── Alarm config ──────────────────────────────────────────────────────────────

const ALARM_RANK: Record<string, number> = { Normal: 0, Alert: 1, Warning: 2, Danger: 3 };

const ALARM = {
  Danger:  { bg: 'bg-red-100',    text: 'text-red-700',    bar: 'bg-red-500',    dot: 'bg-red-500',    badge: 'bg-red-100 text-red-700'       },
  Warning: { bg: 'bg-orange-100', text: 'text-orange-700', bar: 'bg-orange-500', dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700'  },
  Alert:   { bg: 'bg-yellow-100', text: 'text-yellow-700', bar: 'bg-yellow-400', dot: 'bg-yellow-400', badge: 'bg-yellow-100 text-yellow-700'  },
  Normal:  { bg: 'bg-green-100',  text: 'text-green-700',  bar: 'bg-green-500',  dot: 'bg-green-500',  badge: 'bg-green-100 text-green-700'    },
};
const A = (l: string) => ALARM[l as keyof typeof ALARM] ?? ALARM.Normal;

function fmt(n: number | null, d = 2) { return n == null ? '—' : n.toFixed(d); }
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

type Tab = 'overview' | 'findings' | 'kpis' | 'qr';

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-1.5 ${
        active ? 'border-primary text-primary' : 'border-transparent text-gray-400 hover:text-gray-600'
      }`}>
      {label}
      {count !== undefined && (
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${active ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ info, onImageUpload, uploading }: {
  info: EquipmentInfo | null;
  onImageUpload: (file: File) => void;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dash = (v: string | null | undefined) => v || '—';

  const mainFields = [
    { label: 'Asset Type',        value: dash(info?.asset_type) },
    { label: 'Manufacturer',      value: dash(info?.manufacturer) },
    { label: 'Model',             value: dash(info?.model) },
    { label: 'Serial Number',     value: dash(info?.serial_number) },
    { label: 'Installation Date', value: fmtDate(info?.installation_date ?? null) },
    { label: 'Status',            value: info?.status ?? 'active', isStatus: true },
    { label: 'Location Notes',    value: dash(info?.location_notes) },
  ];

  const specFields = [
    { label: 'Rated Power',   value: dash(info?.spec_rated_power) },
    { label: 'Rated Speed',   value: dash(info?.spec_rated_speed) },
    { label: 'Flow Rate',     value: dash(info?.spec_flow_rate) },
    { label: 'Pressure',      value: dash(info?.spec_pressure) },
    { label: 'Temperature',   value: dash(info?.spec_temperature) },
    { label: 'Weight',        value: dash(info?.spec_weight) },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex">
        {/* Equipment image */}
        <div className="w-72 shrink-0 bg-gray-50 border-r border-gray-100 flex flex-col items-center justify-center p-6 min-h-[280px]">
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={e => { if (e.target.files?.[0]) onImageUpload(e.target.files[0]); e.target.value = ''; }} />
          {info?.image_url ? (
            <div className="flex flex-col items-center gap-3 w-full">
              <img src={info.image_url} alt={info?.tag ?? ''} className="max-w-full max-h-44 object-contain rounded" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-primary transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                {uploading ? 'Uploading…' : 'Change image'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex flex-col items-center gap-3 w-full border-2 border-dashed border-gray-200 rounded-xl p-8 hover:border-primary/40 hover:bg-blue-50/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading
                ? <Loader2 size={36} className="text-gray-300 animate-spin" />
                : <><Wrench size={36} className="text-gray-200" /><ImagePlus size={20} className="text-gray-300 -mt-2" /></>
              }
              <div className="text-center">
                <p className="text-sm font-medium text-gray-400">{uploading ? 'Uploading…' : 'Upload image'}</p>
                <p className="text-xs text-gray-300 mt-0.5">PNG, JPG, WebP</p>
              </div>
            </button>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 p-6 space-y-6">
          {/* Main fields */}
          <div className="grid grid-cols-2 gap-x-10 gap-y-4">
            {mainFields.map(f => (
              <div key={f.label}>
                <p className="text-xs text-gray-400 mb-0.5">{f.label}</p>
                {f.isStatus ? (
                  <span className={`inline-flex text-xs font-semibold px-2 py-0.5 rounded-full ${
                    f.value === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>{f.value}</span>
                ) : (
                  <p className="text-sm font-semibold text-gray-900">{f.value}</p>
                )}
              </div>
            ))}
          </div>

          {/* Tech specs */}
          <div>
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Technical Specifications</p>
            <div className="grid grid-cols-3 gap-x-8 gap-y-3 bg-gray-50 rounded-xl p-4">
              {specFields.map(f => (
                <div key={f.label}>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{f.label}</p>
                  <p className="text-sm font-semibold text-gray-800">{f.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Findings tab ──────────────────────────────────────────────────────────────

function FindingsTab({ findings }: { findings: DerivedFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
        <ClipboardList size={32} className="opacity-30 mb-3" />
        <p className="text-sm font-medium">No findings</p>
        <p className="text-xs mt-1">All measurement points are reading Normal</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="divide-y divide-gray-100">
        {findings.map(f => {
          const cfg = A(f.alarmLevel);
          return (
            <div key={f.id} className="px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${cfg.badge}`}>{f.alarmLevel.toLowerCase()}</span>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-cyan-50 text-cyan-600">ultrasound</span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {f.alarmLevel} condition detected at <span className="font-semibold">{f.pointName}</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Component: {f.componentName} · Overall RMS: {fmt(f.overallRms)} · Peak: {fmt(f.peak)}
                  </p>
                </div>
                <span className="text-xs text-gray-400 shrink-0 mt-0.5">{fmtDate(f.measuredAt)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── KPIs tab ──────────────────────────────────────────────────────────────────

function KPIsTab({ components }: { components: ComponentData[] }) {
  const allMeas = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp => mp.measurements ?? []));
  const dangerCount  = allMeas.filter(m => m.alarm_level === 'Danger').length;
  const warningCount = allMeas.filter(m => m.alarm_level === 'Warning').length;
  const alertCount   = allMeas.filter(m => m.alarm_level === 'Alert').length;
  const normalCount  = allMeas.filter(m => m.alarm_level === 'Normal').length;
  const total = allMeas.length;

  const kpis = [
    { label: 'MTBF',            value: '—',   sub: 'hours',    note: 'Requires work order history' },
    { label: 'MTTR',            value: '—',   sub: 'hours',    note: 'Requires work order history' },
    { label: 'Availability',    value: '—',   sub: '%',        note: 'Requires work order history' },
    { label: 'WO Backlog',      value: '—',   sub: 'open',     note: 'Requires work order data'    },
    { label: 'Total Readings',  value: total, sub: 'points',   note: '' },
    { label: 'Critical Points', value: dangerCount + warningCount, sub: 'in alarm', note: '' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        {kpis.map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{k.label}</p>
            <p className="text-3xl font-bold text-gray-900">{k.value}</p>
            <p className="text-xs text-gray-400 mt-1">{k.sub}</p>
            {k.note && <p className="text-[10px] text-gray-300 mt-2">{k.note}</p>}
          </div>
        ))}
      </div>

      {total > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-4">Alarm Breakdown</p>
          <div className="space-y-3">
            {[
              { label: 'Danger',  count: dangerCount  },
              { label: 'Warning', count: warningCount },
              { label: 'Alert',   count: alertCount   },
              { label: 'Normal',  count: normalCount  },
            ].map(({ label, count }) => {
              const cfg = A(label);
              return (
                <div key={label} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                  <span className="text-sm text-gray-600 w-16">{label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-2">
                    <div className={`h-2 rounded-full ${cfg.bar}`} style={{ width: total > 0 ? `${(count / total) * 100}%` : '0%' }} />
                  </div>
                  <span className="text-sm font-semibold text-gray-700 w-6 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── QR Code tab ───────────────────────────────────────────────────────────────

function QRTab({ tag, displayName }: { tag: string; displayName: string | null }) {
  const handlePrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`
      <html><head><title>QR Label - ${tag}</title>
      <style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;gap:12px;margin:0}h2{margin:0;font-size:20px;color:#1e3a5f}p{margin:0;font-size:13px;color:#666}</style>
      </head><body>
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(tag)}" width="200" height="200"/>
      <h2>${tag}</h2>
      ${displayName ? `<p>${displayName}</p>` : ''}
      <script>window.onload=()=>{window.print();window.close()}</script>
      </body></html>
    `);
    w.document.close();
  };

  return (
    <div className="flex justify-center py-10">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 flex flex-col items-center gap-5">
        <QRCodeSVG value={tag} size={200} level="H" includeMargin />
        <div className="text-center">
          <p className="text-lg font-bold text-primary">{tag}</p>
          {displayName && <p className="text-sm text-gray-400 mt-0.5">{displayName}</p>}
        </div>
        <button onClick={handlePrint}
          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-light transition-colors">
          <QrCode size={16} />
          Print QR Label
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EquipmentDetail({ equipmentId, equipmentTag, onBack }: Props) {
  const [activeTab, setActiveTab]   = useState<Tab>('overview');
  const [info, setInfo]             = useState<EquipmentInfo | null>(null);
  const [components, setComponents] = useState<ComponentData[]>([]);
  const [loading, setLoading]       = useState(true);
  const [uploading, setUploading]   = useState(false);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext  = file.name.split('.').pop() ?? 'jpg';
      const path = `${equipmentId}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from('equipment-images')
        .upload(path, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: { publicUrl } } = supabase.storage
        .from('equipment-images')
        .getPublicUrl(path);

      await supabase.from('equipment').update({ image_url: publicUrl }).eq('id', equipmentId);
      setInfo(prev => prev ? { ...prev, image_url: publicUrl } : prev);
    } catch (err) {
      console.error('Image upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        // 1. Base equipment info (image_url included — column exists)
        const baseRes = await supabase
          .from('equipment')
          .select(`id, tag, image_url, sections ( uas_name, lines ( name ) )`)
          .eq('id', equipmentId)
          .single();

        // 2. Extended fields (only after migration — silently skip on error)
        const extRes = await supabase
          .from('equipment')
          .select(`display_name, asset_type, manufacturer, model, serial_number, installation_date, status, location_notes, spec_rated_power, spec_rated_speed, spec_flow_rate, spec_pressure, spec_temperature, spec_weight`)
          .eq('id', equipmentId)
          .single();

        setInfo({
          ...(baseRes.data ?? {}),
          ...(extRes.error ? {} : (extRes.data ?? {})),
        } as unknown as EquipmentInfo);

        // 3. Components for this equipment
        const compRes = await supabase
          .from('components')
          .select('id, name')
          .eq('equipment_id', equipmentId)
          .order('name');

        const comps = compRes.data ?? [];

        // 4. Measurement points for those components
        const compIds = comps.map(c => c.id);
        const mpRes = compIds.length > 0
          ? await supabase.from('measurement_points').select('id, name, component_id').in('component_id', compIds)
          : { data: [] };

        const mps = mpRes.data ?? [];

        // 5. Measurements for those points
        const mpIds = mps.map(mp => mp.id);
        const measRes = mpIds.length > 0
          ? await supabase
              .from('measurements')
              .select('id, overall_rms, max_rms, peak, crest_factor, alarm_level, measured_at, measurement_point_id')
              .in('measurement_point_id', mpIds)
              .order('measured_at', { ascending: false })
          : { data: [] };

        const measData = measRes.data ?? [];

        // Assemble ComponentData[] from flat results
        const assembled: ComponentData[] = comps.map(comp => ({
          id:   comp.id,
          name: comp.name,
          measurement_points: mps
            .filter(mp => mp.component_id === comp.id)
            .map(mp => ({
              id:   mp.id,
              name: mp.name,
              measurements: measData.filter(m => m.measurement_point_id === mp.id),
            })),
        }));

        setComponents(assembled);
      } catch (err) {
        console.error('EquipmentDetail load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [equipmentId]);

  // Derive findings from measurements — any non-Normal alarm
  const findings: DerivedFinding[] = components.flatMap(comp =>
    (comp.measurement_points ?? []).flatMap(mp =>
      (mp.measurements ?? [])
        .filter(m => m.alarm_level !== 'Normal')
        .map(m => ({
          id:            m.id,
          alarmLevel:    m.alarm_level,
          pointName:     mp.name,
          componentName: comp.name,
          overallRms:    m.overall_rms,
          peak:          m.peak,
          measuredAt:    m.measured_at,
        }))
    )
  ).sort((a, b) =>
    ALARM_RANK[b.alarmLevel] - ALARM_RANK[a.alarmLevel] ||
    b.measuredAt.localeCompare(a.measuredAt)
  );

  const allMeas    = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp => mp.measurements ?? []));
  const worstAlarm = allMeas.reduce((w, m) => ALARM_RANK[m.alarm_level] > ALARM_RANK[w] ? m.alarm_level : w, 'Normal');
  const cfg        = A(worstAlarm);

  const lineName = (info?.sections as unknown as { uas_name: string; lines: { name: string } } | null)?.lines?.name ?? '';
  const secName  = (info?.sections as unknown as { uas_name: string; lines: { name: string } } | null)?.uas_name ?? '';

  const tabs = [
    { id: 'overview' as Tab, label: 'Overview'                       },
    { id: 'findings' as Tab, label: 'Findings', count: findings.length },
    { id: 'kpis'     as Tab, label: 'KPIs'                            },
    { id: 'qr'       as Tab, label: 'QR Code'                         },
  ];

  return (
    <div>
      {/* Back + header */}
      <div className="mb-5">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors mb-3">
          <ArrowLeft size={15} /> Back to Asset Tree
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{info?.display_name ?? equipmentTag}</h1>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <span className="text-xs px-2.5 py-0.5 rounded border font-medium bg-gray-50 text-gray-700 border-gray-200">Equipment</span>
          <span className="text-xs px-2.5 py-0.5 rounded border font-medium bg-gray-50 text-gray-600 border-gray-200">{equipmentTag}</span>
          {lineName && <span className="text-xs px-2.5 py-0.5 rounded border font-medium bg-blue-50 text-blue-700 border-blue-200">{lineName}</span>}
          {secName  && <span className="text-xs px-2.5 py-0.5 rounded border font-medium bg-orange-50 text-orange-700 border-orange-200">{secName}</span>}
          {allMeas.length > 0 && (
            <span className={`text-xs px-2.5 py-0.5 rounded border font-medium ${cfg.bg} ${cfg.text}`}>{worstAlarm}</span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
        {tabs.map(t => (
          <TabBtn key={t.id} active={activeTab === t.id} label={t.label} count={t.count} onClick={() => setActiveTab(t.id)} />
        ))}
      </div>

      {/* Tab content */}
      {loading ? (
        <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin text-gray-300" /></div>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewTab info={info} onImageUpload={handleImageUpload} uploading={uploading} />}
          {activeTab === 'findings' && <FindingsTab findings={findings} />}
          {activeTab === 'kpis'     && <KPIsTab components={components} />}
          {activeTab === 'qr'       && <QRTab tag={equipmentTag} displayName={info?.display_name ?? null} />}
        </>
      )}
    </div>
  );
}
