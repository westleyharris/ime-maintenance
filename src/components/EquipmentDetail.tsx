import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, QrCode, ClipboardList, Loader2, Wrench, ImagePlus, CheckCircle2, AlertTriangle, ShieldAlert, AlertCircle, ChevronDown } from 'lucide-react';
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
  status_note: string | null;
  last_replaced_at: string | null;
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

interface EquipmentNote {
  id: string;
  note_type: 'general' | 'status_change' | 'replacement';
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
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

type Tab = 'overview' | 'asset-health' | 'workorders' | 'kpis' | 'qr';

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

function OverviewTab({ info, onImageUpload, uploading, isCompliant }: {
  info: EquipmentInfo | null;
  onImageUpload: (file: File) => void;
  uploading: boolean;
  isCompliant: boolean | null;
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
            {/* Compliance badge */}
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Route Compliance</p>
              {isCompliant === null
                ? <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">No measurements</span>
                : isCompliant
                  ? <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ In Compliance</span>
                  : <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">✕ Out of Compliance</span>
              }
            </div>
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

// ── Asset Health tab ──────────────────────────────────────────────────────────

const ALARM_ICON: Record<string, React.ReactNode> = {
  Danger:  <ShieldAlert  size={14} />,
  Warning: <AlertTriangle size={14} />,
  Alert:   <AlertCircle  size={14} />,
  Normal:  <CheckCircle2 size={14} />,
};

function AssetHealthTab({ findings, components, lastReplacedAt }: {
  findings: DerivedFinding[];
  components: ComponentData[];
  lastReplacedAt: string | null;
}) {
  // Split findings into current (post-replacement) and archived (pre-replacement)
  const replacedTs = lastReplacedAt ? new Date(lastReplacedAt).getTime() : null;
  const currentFindings  = replacedTs
    ? findings.filter(f => new Date(f.measuredAt).getTime() > replacedTs)
    : findings;
  const archivedFindings = replacedTs
    ? findings.filter(f => new Date(f.measuredAt).getTime() <= replacedTs)
    : [];

  const totalPts = components.reduce((sum, c) => sum + (c.measurement_points?.length ?? 0), 0);
  const isHealthy = currentFindings.length === 0;

  // Worst alarm level per component (current measurements only)
  const componentHealth = components.map(comp => {
    const meas  = (comp.measurement_points ?? []).flatMap(mp =>
      (mp.measurements ?? []).filter(m => !replacedTs || new Date(m.measured_at).getTime() > replacedTs)
    );
    const worst = meas.reduce((w, m) => ALARM_RANK[m.alarm_level] > ALARM_RANK[w] ? m.alarm_level : w, 'Normal');
    return { ...comp, worst, hasMeasurements: meas.length > 0 };
  });

  const allCurrentMeas = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp =>
    (mp.measurements ?? []).filter(m => !replacedTs || new Date(m.measured_at).getTime() > replacedTs)
  ));
  const overallWorst = allCurrentMeas.reduce((w, m) =>
    ALARM_RANK[m.alarm_level] > ALARM_RANK[w] ? m.alarm_level : w, 'Normal'
  );
  const overallCfg = A(overallWorst);
  const allHistoricalMeas = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp => mp.measurements ?? []));

  // No data state
  if (allHistoricalMeas.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
        <ClipboardList size={32} className="opacity-30 mb-3" />
        <p className="text-sm font-medium">No measurement data</p>
        <p className="text-xs mt-1">Upload a UAS file to populate health data</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* Overall health banner */}
      {/* Replacement notice */}
      {lastReplacedAt && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-orange-700">
          <Wrench size={14} className="shrink-0" />
          <span>Asset replaced on <span className="font-semibold">{fmtDate(lastReplacedAt)}</span> — showing current measurements only. Archived data is below.</span>
        </div>
      )}

      {/* Current health banner */}
      {allCurrentMeas.length === 0 && lastReplacedAt ? (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-blue-400 flex items-center justify-center shrink-0">
            <ClipboardList size={20} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-800">Awaiting First Measurement</p>
            <p className="text-xs text-blue-600 mt-0.5">No measurements recorded since replacement on {fmtDate(lastReplacedAt)}</p>
          </div>
        </div>
      ) : isHealthy ? (
        <div className="bg-green-50 rounded-xl border border-green-200 p-5 flex items-center gap-4">
          <div className="w-11 h-11 rounded-full bg-green-500 flex items-center justify-center shrink-0">
            <CheckCircle2 size={22} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-green-800">All Clear — Equipment is Healthy</p>
            <p className="text-xs text-green-600 mt-0.5">
              {totalPts} measurement point{totalPts !== 1 ? 's' : ''} reading Normal · No issues detected
            </p>
          </div>
        </div>
      ) : (
        <div className={`rounded-xl border p-5 flex items-center gap-4 ${overallCfg.bg} border-current`}>
          <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${overallCfg.bar}`}>
            <span className="text-white">{ALARM_ICON[overallWorst]}</span>
          </div>
          <div>
            <p className={`text-sm font-bold ${overallCfg.text}`}>
              {overallWorst} — Attention Required
            </p>
            <p className={`text-xs mt-0.5 ${overallCfg.text} opacity-80`}>
              {currentFindings.length} active finding{currentFindings.length !== 1 ? 's' : ''} across {totalPts} measurement point{totalPts !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}

      {/* Component health breakdown */}
      {components.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Component Health</p>
          </div>
          <div className="divide-y divide-gray-50">
            {componentHealth.map(comp => {
              const cfg    = A(comp.worst);
              const mpCount = comp.measurement_points?.length ?? 0;
              const issueCount = (comp.measurement_points ?? [])
                .flatMap(mp => mp.measurements ?? [])
                .filter(m => m.alarm_level !== 'Normal').length;
              return (
                <div key={comp.id} className="px-5 py-3.5 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{comp.name}</p>
                    <p className="text-xs text-gray-400">
                      {mpCount} point{mpCount !== 1 ? 's' : ''}
                      {issueCount > 0 ? ` · ${issueCount} issue${issueCount !== 1 ? 's' : ''}` : ''}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${cfg.badge}`}>
                    {ALARM_ICON[comp.worst]}
                    {comp.worst}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Active findings list */}
      {currentFindings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Active Findings</p>
            <span className="text-xs font-semibold text-gray-400">{currentFindings.length} total</span>
          </div>
          <div className="divide-y divide-gray-100">
            {currentFindings.map(f => {
              const cfg = A(f.alarmLevel);
              return (
                <div key={f.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${cfg.badge}`}>
                          {ALARM_ICON[f.alarmLevel]}
                          {f.alarmLevel}
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-cyan-50 text-cyan-600">ultrasound</span>
                      </div>
                      <p className="text-sm font-medium text-gray-900">
                        {f.alarmLevel} condition at <span className="font-semibold">{f.pointName}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {f.componentName} · RMS: {fmt(f.overallRms)} · Peak: {fmt(f.peak)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 mt-0.5 whitespace-nowrap">{fmtDate(f.measuredAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Archived findings (pre-replacement) */}
      {archivedFindings.length > 0 && (
        <div className="rounded-xl border border-gray-200 overflow-hidden opacity-60">
          <div className="px-5 py-3 border-b border-gray-200 bg-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Archived — Prior to Replacement</span>
            </div>
            <span className="text-xs text-gray-400">{archivedFindings.length} findings</span>
          </div>
          <div className="divide-y divide-gray-100 bg-gray-50">
            {archivedFindings.map(f => {
              const cfg = A(f.alarmLevel);
              return (
                <div key={f.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded ${cfg.badge}`}>
                          {ALARM_ICON[f.alarmLevel]}
                          {f.alarmLevel}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-200 text-gray-500">archived</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        {f.alarmLevel} at <span className="font-medium">{f.pointName}</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {f.componentName} · RMS: {fmt(f.overallRms)} · Peak: {fmt(f.peak)}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 mt-0.5 whitespace-nowrap">{fmtDate(f.measuredAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Work Orders tab ───────────────────────────────────────────────────────────

function WorkOrdersTab() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 flex flex-col items-center justify-center py-16 text-gray-400">
      <ClipboardList size={32} className="opacity-30 mb-3" />
      <p className="text-sm font-medium">No work orders</p>
      <p className="text-xs mt-1 text-gray-300">Work order data will be connected here</p>
    </div>
  );
}

// ── KPIs tab ──────────────────────────────────────────────────────────────────

function KPIsTab({ components, status, lastReplacedAt }: {
  components: ComponentData[];
  status: string | null;
  lastReplacedAt: string | null;
}) {
  const replacedTs = lastReplacedAt ? new Date(lastReplacedAt).getTime() : null;
  // KPIs use only current measurements (post-replacement if applicable)
  const allMeas = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp =>
    (mp.measurements ?? []).filter(m => !replacedTs || new Date(m.measured_at).getTime() > replacedTs)
  ));
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
      {status === 'inactive' && (
        <div className="bg-gray-100 border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-500 font-medium">
          ⚠ This asset is inactive — KPI data is shown for reference only and excluded from site-level calculations.
        </div>
      )}
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

// ── Asset Status Panel ────────────────────────────────────────────────────────

function AssetStatusPanel({ info, onStatusUpdate, onRecordReplacement, saving }: {
  info: EquipmentInfo | null;
  onStatusUpdate: (status: string, note: string) => void;
  onRecordReplacement: () => void;
  saving: boolean;
}) {
  const [localStatus, setLocalStatus] = useState(info?.status ?? 'active');
  const [localNote,   setLocalNote]   = useState(info?.status_note ?? '');
  const [dirty, setDirty]             = useState(false);

  // Sync with parent data after loads
  useEffect(() => {
    setLocalStatus(info?.status ?? 'active');
    setLocalNote(info?.status_note ?? '');
    setDirty(false);
  }, [info?.status, info?.status_note]);

  const STATUS_OPTS = [
    { value: 'active',   label: 'Active',   dot: 'bg-green-500',  text: 'text-green-700',  ring: 'ring-green-400',  bg: 'bg-green-50'  },
    { value: 'inactive', label: 'Inactive', dot: 'bg-gray-400',   text: 'text-gray-600',   ring: 'ring-gray-400',   bg: 'bg-gray-100'  },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-800">Operational Status</p>
        {info?.last_replaced_at && (
          <span className="text-xs text-gray-400">
            Last replaced: {fmtDate(info.last_replaced_at)}
          </span>
        )}
      </div>

      {/* Status toggle */}
      <div className="flex gap-2">
        {STATUS_OPTS.map(opt => (
          <button
            key={opt.value}
            onClick={() => { setLocalStatus(opt.value); setDirty(true); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
              localStatus === opt.value
                ? `${opt.bg} ${opt.text} ring-2 ${opt.ring} border-transparent`
                : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${opt.dot}`} />
            {opt.label}
          </button>
        ))}
      </div>

      {/* Note field */}
      <div>
        <label className="text-xs font-semibold text-gray-400 block mb-1.5">
          {localStatus === 'inactive' ? 'Reason for inactivity' : 'Status note (optional)'}
        </label>
        <textarea
          value={localNote}
          onChange={e => { setLocalNote(e.target.value); setDirty(true); }}
          placeholder={localStatus === 'inactive'
            ? 'e.g. Motor bearing failure, pending replacement…'
            : 'Add a note about this asset…'}
          rows={2}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-gray-300"
        />
      </div>

      {/* Actions row */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          onClick={onRecordReplacement}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 transition-colors"
        >
          <Wrench size={14} />
          Record Replacement
        </button>
        {dirty && (
          <button
            onClick={() => { onStatusUpdate(localStatus, localNote); setDirty(false); }}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            Save
          </button>
        )}
      </div>
    </div>
  );
}

// ── Activity Log ──────────────────────────────────────────────────────────────

const NOTE_STYLE: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  replacement:   { icon: <Wrench size={13} />,        color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200'   },
  status_change: { icon: <AlertCircle size={13} />,   color: 'text-blue-600',   bg: 'bg-blue-50 border-blue-200'       },
  general:       { icon: <ClipboardList size={13} />, color: 'text-gray-500',   bg: 'bg-gray-50 border-gray-200'       },
};

function ActivityLog({ notes }: { notes: EquipmentNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Activity Log</p>
      </div>
      <div className="divide-y divide-gray-50">
        {notes.map(n => {
          const s = NOTE_STYLE[n.note_type] ?? NOTE_STYLE.general;
          const priorSpecs = n.note_type === 'replacement' && n.metadata?.prior_specs
            ? (n.metadata.prior_specs as Record<string, string | null>)
            : null;
          return (
            <div key={n.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 flex items-center justify-center w-6 h-6 rounded-full border shrink-0 ${s.bg} ${s.color}`}>
                  {s.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-xs font-bold uppercase tracking-wide ${s.color}`}>
                      {n.note_type === 'replacement' ? 'Asset Replaced'
                        : n.note_type === 'status_change' ? 'Status Changed'
                        : 'Note'}
                    </p>
                    <span className="text-xs text-gray-400 shrink-0">{fmtDate(n.created_at)}</span>
                  </div>
                  {n.message && <p className="text-sm text-gray-700 mt-1">{n.message}</p>}
                  {priorSpecs && (
                    <div className="mt-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100 text-xs text-gray-500 space-y-0.5">
                      <p className="font-semibold text-gray-400 uppercase tracking-wide text-[10px] mb-1">Prior Asset Specs</p>
                      {priorSpecs.manufacturer && <p>Manufacturer: {priorSpecs.manufacturer}</p>}
                      {priorSpecs.model        && <p>Model: {priorSpecs.model}</p>}
                      {priorSpecs.serial_number && <p>Serial: {priorSpecs.serial_number}</p>}
                      {priorSpecs.asset_type   && <p>Type: {priorSpecs.asset_type}</p>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Prior Asset Card ──────────────────────────────────────────────────────────

function PriorAssetCard({ note }: { note: EquipmentNote }) {
  const [expanded, setExpanded] = useState(false);
  const prior = (note.metadata?.prior_specs ?? {}) as Record<string, string | null>;
  const replacedAt = (note.metadata?.replaced_at as string | null) ?? note.created_at;
  const dash = (v: string | null | undefined) => v || '—';

  const fields = [
    { label: 'Asset Type',        value: dash(prior.asset_type) },
    { label: 'Manufacturer',      value: dash(prior.manufacturer) },
    { label: 'Model',             value: dash(prior.model) },
    { label: 'Serial Number',     value: dash(prior.serial_number) },
    { label: 'Installation Date', value: fmtDate(prior.installation_date ?? null) },
    { label: 'Rated Power',       value: dash(prior.spec_rated_power) },
    { label: 'Rated Speed',       value: dash(prior.spec_rated_speed) },
    { label: 'Flow Rate',         value: dash(prior.spec_flow_rate) },
    { label: 'Pressure',          value: dash(prior.spec_pressure) },
    { label: 'Temperature',       value: dash(prior.spec_temperature) },
    { label: 'Weight',            value: dash(prior.spec_weight) },
  ];

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden opacity-60 hover:opacity-80 transition-opacity">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 bg-gray-100 border-b border-gray-200 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <Wrench size={14} className="text-gray-400" />
          <span className="text-xs font-bold uppercase tracking-wide text-gray-400">
            Prior Asset — Replaced {fmtDate(replacedAt)}
          </span>
        </div>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="bg-gray-50">
          <div className="flex">
            {/* Old image */}
            <div className="w-56 shrink-0 border-r border-gray-200 flex items-center justify-center p-5 min-h-[200px]">
              {prior.image_url ? (
                <img src={prior.image_url} alt="Prior asset" className="max-w-full max-h-36 object-contain rounded grayscale opacity-70" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-300">
                  <Wrench size={32} />
                  <p className="text-xs">No image</p>
                </div>
              )}
            </div>
            {/* Old specs */}
            <div className="flex-1 p-5">
              {note.message && (
                <p className="text-xs text-gray-500 italic mb-4 pb-3 border-b border-gray-200">"{note.message}"</p>
              )}
              <div className="grid grid-cols-3 gap-x-8 gap-y-3">
                {fields.map(f => (
                  <div key={f.label}>
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-0.5">{f.label}</p>
                    <p className="text-sm text-gray-500">{f.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Replace Modal (2-step) ────────────────────────────────────────────────────

interface NewAssetSpecs {
  manufacturer: string;
  model: string;
  serial_number: string;
  installation_date: string;
  spec_rated_power: string;
  spec_rated_speed: string;
  spec_flow_rate: string;
  spec_pressure: string;
  spec_temperature: string;
  spec_weight: string;
}

function ReplaceModal({ equipmentId, currentInfo, onComplete, onCancel }: {
  equipmentId: string;
  currentInfo: EquipmentInfo | null;
  onComplete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep]         = useState<1 | 2>(1);
  const [note, setNote]         = useState('');
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]     = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [specs, setSpecs]       = useState<NewAssetSpecs>({
    manufacturer:      '',
    model:             '',
    serial_number:     '',
    installation_date: new Date().toISOString().slice(0, 10),
    spec_rated_power:  '',
    spec_rated_speed:  '',
    spec_flow_rate:    '',
    spec_pressure:     '',
    spec_temperature:  '',
    spec_weight:       '',
  });
  const [newImageFile,    setNewImageFile]    = useState<File | null>(null);
  const [newImagePreview, setNewImagePreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sp = (k: keyof NewAssetSpecs) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSpecs(prev => ({ ...prev, [k]: e.target.value }));

  async function confirmReplacement() {
    setConfirming(true);
    const now = new Date().toISOString();
    const snapshot = {
      image_url:         currentInfo?.image_url,
      display_name:      currentInfo?.display_name,
      asset_type:        currentInfo?.asset_type,
      manufacturer:      currentInfo?.manufacturer,
      model:             currentInfo?.model,
      serial_number:     currentInfo?.serial_number,
      installation_date: currentInfo?.installation_date,
      spec_rated_power:  currentInfo?.spec_rated_power,
      spec_rated_speed:  currentInfo?.spec_rated_speed,
      spec_flow_rate:    currentInfo?.spec_flow_rate,
      spec_pressure:     currentInfo?.spec_pressure,
      spec_temperature:  currentInfo?.spec_temperature,
      spec_weight:       currentInfo?.spec_weight,
    };
    await supabase.from('equipment').update({
      last_replaced_at: now,
      status:           'active',
      status_note:      null,
    }).eq('id', equipmentId);
    await supabase.from('equipment_notes').insert({
      equipment_id: equipmentId,
      note_type:    'replacement',
      message:      note || 'Asset replaced',
      metadata:     { replaced_at: now, prior_specs: snapshot },
    });
    setConfirming(false);
    setStep(2);
  }

  async function saveNewSpecs() {
    setSaving(true);
    setSaveError(null);

    // ── 1. Upload new image first (image_url column always exists) ────────────
    let imageUrl = currentInfo?.image_url ?? null;
    if (newImageFile) {
      const ext  = newImageFile.name.split('.').pop() ?? 'jpg';
      const path = `${equipmentId}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('equipment-images')
        .upload(path, newImageFile, { upsert: true });
      if (uploadErr) {
        console.error('Image upload failed:', uploadErr);
      } else {
        imageUrl = supabase.storage.from('equipment-images').getPublicUrl(path).data.publicUrl;
      }
    }

    // ── 2. Update image_url (always safe, column exists) ─────────────────────
    if (imageUrl !== currentInfo?.image_url) {
      const { error: imgErr } = await supabase
        .from('equipment')
        .update({ image_url: imageUrl })
        .eq('id', equipmentId);
      if (imgErr) console.error('image_url update failed:', imgErr);
    }

    // ── 3. Update extended spec fields (requires equipment_extended_fields migration) ──
    const specUpdates: Record<string, string> = {};
    (Object.keys(specs) as (keyof NewAssetSpecs)[]).forEach(k => {
      if (specs[k].trim()) specUpdates[k] = specs[k].trim();
    });

    if (Object.keys(specUpdates).length > 0) {
      const { error: specErr } = await supabase
        .from('equipment')
        .update(specUpdates)
        .eq('id', equipmentId);

      if (specErr) {
        console.error('Spec update failed:', specErr);
        // Most likely cause: extended fields migration not yet run in Supabase
        setSaveError(
          `Could not save asset details: ${specErr.message}. ` +
          `Make sure you have run the "equipment_extended_fields.sql" migration in Supabase SQL Editor.`
        );
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    await onComplete();
  }

  function pickImage(file: File) {
    setNewImageFile(file);
    const reader = new FileReader();
    reader.onload = e => setNewImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-gray-300';
  const labelCls = 'text-xs font-semibold text-gray-400 block mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      {step === 1 ? (
        /* ── Step 1: Confirm ── */
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-md p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <Wrench size={18} className="text-orange-600" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">Record Asset Replacement</p>
              <p className="text-xs text-gray-400 mt-0.5">Step 1 of 2 — Confirm &amp; archive prior asset</p>
            </div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700 space-y-1">
            <p className="font-semibold">What happens next:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Prior measurements are archived (still visible below)</li>
              <li>Current specs are snapshotted to the activity log</li>
              <li>You'll enter the new asset's specs on the next screen</li>
            </ul>
          </div>
          <div>
            <label className={labelCls}>
              Replacement notes <span className="font-normal">(optional)</span>
            </label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Motor bearing failure was root cause. Replaced with same spec unit."
              rows={3}
              className={inputCls + ' resize-none'}
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onCancel}
              className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button onClick={confirmReplacement} disabled={confirming}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {confirming && <Loader2 size={13} className="animate-spin" />}
              Confirm &amp; Continue →
            </button>
          </div>
        </div>
      ) : (
        /* ── Step 2: New asset details ── */
        <div className="bg-white rounded-2xl border border-gray-200 shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-3 p-6 border-b border-gray-100 shrink-0">
            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
              <CheckCircle2 size={18} className="text-green-600" />
            </div>
            <div>
              <p className="text-base font-bold text-gray-900">New Asset Details</p>
              <p className="text-xs text-gray-400 mt-0.5">Step 2 of 2 — Enter the replacement asset's information</p>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Image + main specs row */}
            <div className="flex gap-5">
              {/* Image upload */}
              <div className="shrink-0 w-48">
                <label className={labelCls}>Equipment Photo</label>
                <input ref={fileRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) pickImage(e.target.files[0]); e.target.value = ''; }} />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="w-full border-2 border-dashed border-gray-200 rounded-xl overflow-hidden hover:border-primary/40 transition-colors"
                  style={{ minHeight: 148 }}
                >
                  {newImagePreview ? (
                    <img src={newImagePreview} alt="New asset" className="w-full h-full object-cover" style={{ height: 148 }} />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 p-4" style={{ height: 148 }}>
                      <ImagePlus size={28} className="text-gray-300" />
                      <p className="text-xs text-gray-400 text-center">Click to upload new photo</p>
                      <p className="text-[10px] text-gray-300">PNG, JPG, WebP</p>
                    </div>
                  )}
                </button>
              </div>

              {/* Main fields */}
              <div className="flex-1 grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Manufacturer</label>
                  <input value={specs.manufacturer} onChange={sp('manufacturer')} placeholder="e.g. ABB, Siemens…" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Model</label>
                  <input value={specs.model} onChange={sp('model')} placeholder="e.g. M3BP 55kW" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Serial Number</label>
                  <input value={specs.serial_number} onChange={sp('serial_number')} placeholder="e.g. SN-2024-XXXX" className={inputCls} />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Installation Date</label>
                  <input type="date" value={specs.installation_date} onChange={sp('installation_date')} className={inputCls} />
                </div>
              </div>
            </div>

            {/* Tech specs */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Technical Specifications <span className="font-normal normal-case">(optional)</span></p>
              <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-xl p-4">
                {([
                  ['Rated Power',  'spec_rated_power',  'e.g. 55 kW'],
                  ['Rated Speed',  'spec_rated_speed',  'e.g. 1480 RPM'],
                  ['Flow Rate',    'spec_flow_rate',    'e.g. 120 m³/h'],
                  ['Pressure',     'spec_pressure',     'e.g. 6 bar'],
                  ['Temperature',  'spec_temperature',  'e.g. 80°C max'],
                  ['Weight',       'spec_weight',       'e.g. 320 kg'],
                ] as [string, keyof NewAssetSpecs, string][]).map(([lbl, key, ph]) => (
                  <div key={key}>
                    <label className={labelCls}>{lbl}</label>
                    <input value={specs[key]} onChange={sp(key)} placeholder={ph} className={inputCls} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Footer actions */}
          <div className="p-6 border-t border-gray-100 shrink-0 space-y-3">
            {saveError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700">
                <p className="font-semibold mb-0.5">Save failed</p>
                <p>{saveError}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={onComplete}
                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors">
                Skip for now
              </button>
              <button onClick={saveNewSpecs} disabled={saving}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl bg-primary text-white hover:bg-primary-light disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {saving && <Loader2 size={13} className="animate-spin" />}
                Save New Asset Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EquipmentDetail({ equipmentId, equipmentTag, onBack }: Props) {
  const [activeTab, setActiveTab]       = useState<Tab>('overview');
  const [info, setInfo]                 = useState<EquipmentInfo | null>(null);
  const [components, setComponents]     = useState<ComponentData[]>([]);
  const [loading, setLoading]           = useState(true);
  const [uploading, setUploading]       = useState(false);
  const [notes, setNotes]               = useState<EquipmentNote[]>([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [showReplaceModal, setShowReplaceModal] = useState(false);

  async function loadNotes() {
    const { data } = await supabase
      .from('equipment_notes')
      .select('id, note_type, message, metadata, created_at')
      .eq('equipment_id', equipmentId)
      .order('created_at', { ascending: false });
    setNotes((data ?? []) as EquipmentNote[]);
  }

  async function handleStatusUpdate(newStatus: string, newNote: string) {
    setSavingStatus(true);
    const oldStatus = info?.status ?? 'active';
    await supabase.from('equipment').update({ status: newStatus, status_note: newNote }).eq('id', equipmentId);
    await supabase.from('equipment_notes').insert({
      equipment_id: equipmentId,
      note_type:    'status_change',
      message:      newNote || `Status changed to ${newStatus}`,
      metadata:     { from: oldStatus, to: newStatus },
    });
    setInfo(prev => prev ? { ...prev, status: newStatus, status_note: newNote } : prev);
    await loadNotes();
    setSavingStatus(false);
  }

  // Called by the modal after all steps complete — reloads fresh data from DB
  async function handleReplacementComplete() {
    const [baseRes, extRes] = await Promise.all([
      supabase.from('equipment').select(`id, tag, image_url, sections ( uas_name, lines ( name ) )`).eq('id', equipmentId).single(),
      supabase.from('equipment').select(`display_name, asset_type, manufacturer, model, serial_number, installation_date, status, status_note, last_replaced_at, location_notes, spec_rated_power, spec_rated_speed, spec_flow_rate, spec_pressure, spec_temperature, spec_weight`).eq('id', equipmentId).single(),
    ]);
    setInfo({ ...(baseRes.data ?? {}), ...(extRes.error ? {} : (extRes.data ?? {})) } as unknown as EquipmentInfo);
    await loadNotes();
    setShowReplaceModal(false);
  }

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
          .select(`display_name, asset_type, manufacturer, model, serial_number, installation_date, status, status_note, last_replaced_at, location_notes, spec_rated_power, spec_rated_speed, spec_flow_rate, spec_pressure, spec_temperature, spec_weight`)
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
        // Load activity log (non-blocking)
        supabase
          .from('equipment_notes')
          .select('id, note_type, message, metadata, created_at')
          .eq('equipment_id', equipmentId)
          .order('created_at', { ascending: false })
          .then(({ data }) => setNotes((data ?? []) as EquipmentNote[]));
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

  const allMeas = components.flatMap(c => (c.measurement_points ?? []).flatMap(mp => mp.measurements ?? []));

  // Use only post-replacement measurements for current status indicators
  const replacedTs   = info?.last_replaced_at ? new Date(info.last_replaced_at).getTime() : null;
  const currentMeas  = replacedTs ? allMeas.filter(m => new Date(m.measured_at).getTime() > replacedTs) : allMeas;
  const worstAlarm   = currentMeas.reduce((w, m) => ALARM_RANK[m.alarm_level] > ALARM_RANK[w] ? m.alarm_level : w, 'Normal');
  const cfg          = A(worstAlarm);

  // Current (post-replacement) findings for tab badge
  const currentFindings = replacedTs
    ? findings.filter(f => new Date(f.measuredAt).getTime() > replacedTs)
    : findings;

  // Route compliance based on current measurements only
  const COMPLIANCE_MS = 90 * 24 * 60 * 60 * 1000;
  const latestMeasMs  = currentMeas.length > 0
    ? Math.max(...currentMeas.map(m => new Date(m.measured_at).getTime()))
    : null;
  const isCompliant   = latestMeasMs != null ? (Date.now() - latestMeasMs) <= COMPLIANCE_MS : null;

  // Prior replacement note (for Overview prior-asset card)
  const priorReplacementNote = notes.find(n => n.note_type === 'replacement') ?? null;

  const lineName = (info?.sections as unknown as { uas_name: string; lines: { name: string } } | null)?.lines?.name ?? '';
  const secName  = (info?.sections as unknown as { uas_name: string; lines: { name: string } } | null)?.uas_name ?? '';

  const tabs = [
    { id: 'overview'     as Tab, label: 'Overview'                                                    },
    { id: 'asset-health' as Tab, label: 'Asset Health', count: currentFindings.length > 0 ? currentFindings.length : undefined },
    { id: 'workorders'   as Tab, label: 'Work Orders'                          },
    { id: 'kpis'         as Tab, label: 'KPIs'                                 },
    { id: 'qr'           as Tab, label: 'QR Code'                              },
  ];

  return (
    <div>
      {/* Replace modal */}
      {showReplaceModal && (
        <ReplaceModal
          equipmentId={equipmentId}
          currentInfo={info}
          onComplete={handleReplacementComplete}
          onCancel={() => setShowReplaceModal(false)}
        />
      )}

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
          {currentMeas.length > 0 && (
            <span className={`text-xs px-2.5 py-0.5 rounded border font-medium ${cfg.bg} ${cfg.text}`}>{worstAlarm}</span>
          )}
        </div>
      </div>

      {/* Inactive asset banner */}
      {!loading && info?.status === 'inactive' && (
        <div className="mb-4 bg-gray-100 border border-gray-300 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="w-2 h-2 rounded-full bg-gray-400 shrink-0 mt-1.5" />
          <div>
            <p className="text-sm font-semibold text-gray-600">Asset is currently inactive — excluded from KPIs and compliance</p>
            {info.status_note && <p className="text-xs text-gray-400 mt-0.5">{info.status_note}</p>}
          </div>
        </div>
      )}

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
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <OverviewTab info={info} onImageUpload={handleImageUpload} uploading={uploading} isCompliant={isCompliant} />
              {priorReplacementNote && (
                <PriorAssetCard note={priorReplacementNote} />
              )}
              <AssetStatusPanel
                info={info}
                onStatusUpdate={handleStatusUpdate}
                onRecordReplacement={() => setShowReplaceModal(true)}
                saving={savingStatus}
              />
              <ActivityLog notes={notes} />
            </div>
          )}
          {activeTab === 'asset-health' && (
            <AssetHealthTab findings={findings} components={components} lastReplacedAt={info?.last_replaced_at ?? null} />
          )}
          {activeTab === 'workorders'   && <WorkOrdersTab />}
          {activeTab === 'kpis' && (
            <KPIsTab components={components} status={info?.status ?? null} lastReplacedAt={info?.last_replaced_at ?? null} />
          )}
          {activeTab === 'qr'       && <QRTab tag={equipmentTag} displayName={info?.display_name ?? null} />}
        </>
      )}
    </div>
  );
}
