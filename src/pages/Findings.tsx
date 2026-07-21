import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, X, ClipboardPlus, Building2, ExternalLink, Download, Mail, BellRing,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useScope } from '../context/ScopeContext';
import { useAuth } from '../context/AuthContext';
import { exportToExcel } from '../utils/exportExcel';

// ── Types ──────────────────────────────────────────────────────────────────────

type Condition = 'Warning' | 'Danger';
type FindingStatus = 'open' | 'wo_created' | 'closed';

interface FindingRow {
  id: string;
  condition: Condition;
  finding: string | null;
  recommendation: string | null;
  generatedTag: string | null;
  sapNo: string | null;
  woText: string | null;
  bearingsInfo: string | null;
  comments: string | null;
  creationDate: string;
  status: FindingStatus;
  workOrderId: string | null;
  woNumber: string | null;
  notifiedAt: string | null;
  locationId: string | null;
  line: string;
  section: string;
  equipment: string;
  equipmentId: string | null;
}

interface RawFinding {
  id: string;
  condition: Condition;
  finding: string | null;
  recommendation: string | null;
  generated_tag: string | null;
  sap_no: string | null;
  wo_text: string | null;
  bearings_info: string | null;
  comments: string | null;
  creation_date: string;
  status: FindingStatus;
  work_order_id: string | null;
  notified_at: string | null;
  location_id: string | null;
  equipment_id: string | null;
  equipment: {
    id: string;
    tag: string;
    sections: { uas_name: string; lines: { name: string } | null } | null;
  } | null;
}

// ── Styling ────────────────────────────────────────────────────────────────────

const CONDITION_BADGE: Record<Condition, string> = {
  Warning: 'bg-orange-100 text-orange-700',
  Danger:  'bg-red-100 text-red-700',
};

const STATUS_BADGE: Record<FindingStatus, string> = {
  open:       'bg-blue-50 text-blue-700',
  wo_created: 'bg-purple-50 text-purple-700',
  closed:     'bg-green-50 text-green-700',
};

const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open', wo_created: 'WO Created', closed: 'Closed',
};

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

function flatten(f: RawFinding, woNumber: string | null): FindingRow {
  const eq  = f.equipment;
  const sec = eq?.sections;
  return {
    id: f.id,
    condition: f.condition,
    finding: f.finding,
    recommendation: f.recommendation,
    generatedTag: f.generated_tag,
    sapNo: f.sap_no,
    woText: f.wo_text,
    bearingsInfo: f.bearings_info,
    comments: f.comments,
    creationDate: f.creation_date,
    status: f.status,
    workOrderId: f.work_order_id,
    woNumber,
    notifiedAt: f.notified_at,
    locationId: f.location_id,
    line: sec?.lines?.name ?? '—',
    section: sec?.uas_name ?? '—',
    equipment: eq?.tag ?? '—',
    equipmentId: eq?.id ?? f.equipment_id ?? null,
  };
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Findings() {
  const { selectedCompanyId, selectedLocationId, locations } = useScope();
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === 'ime_admin';
  // company_admin and plant_manager can also create/manage work orders (scope is
  // enforced server-side by RLS); only ime_admin edits recommendations & notifies.
  const canCreateWO = isAdmin || profile?.role === 'company_admin' || profile?.role === 'plant_manager';

  const navigate = useNavigate();
  const [rows, setRows]       = useState<FindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FindingRow | null>(null);
  const [startWO, setStartWO]   = useState(false);

  const [search, setSearch]           = useState('');
  const [filterLine, setFilterLine]   = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterStatus, setFilterStatus]       = useState('');

  // Notification selection (admin only)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showNotify, setShowNotify]   = useState(false);

  const toggleSelected = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const openFinding = (r: FindingRow, wo = false) => { setStartWO(wo); setSelected(r); };

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); return; }
    setLoading(true);
    // Auto-derive findings from the latest Warning/Danger readings first.
    await supabase.rpc('reconcile_findings');

    let q = supabase
      .from('findings')
      .select(`
        id, condition, finding, recommendation, generated_tag, sap_no, wo_text,
        bearings_info, comments, creation_date, status, work_order_id, notified_at, location_id, equipment_id,
        equipment ( id, tag, sections ( uas_name, lines ( name ) ) )
      `)
      .eq('company_id', selectedCompanyId);
    if (selectedLocationId) q = q.eq('location_id', selectedLocationId);

    const { data } = await q;

    // Linked work order numbers (separate fetch avoids the dual-FK ambiguity).
    const { data: wos } = await supabase
      .from('work_orders')
      .select('id, wo_number')
      .eq('company_id', selectedCompanyId);
    const woMap = new Map((wos ?? []).map(w => [w.id as string, w.wo_number as string]));

    const flat = ((data ?? []) as unknown as RawFinding[])
      .map(f => flatten(f, f.work_order_id ? woMap.get(f.work_order_id) ?? null : null));
    setRows(flat);
    setSelectedIds(new Set());
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const lineOptions = Array.from(new Set(rows.map(r => r.line))).filter(l => l && l !== '—').sort();

  const visible = rows
    .filter(r => {
      if (filterStatus && r.status !== filterStatus) return false;
      if (filterLine && r.line !== filterLine) return false;
      if (filterCondition && r.condition !== filterCondition) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(`${r.equipment} ${r.generatedTag ?? ''} ${r.line} ${r.section}`
          .toLowerCase().includes(q))) return false;
      }
      return true;
    })
    .sort((a, b) =>
      (a.condition === b.condition ? 0 : a.condition === 'Danger' ? -1 : 1) ||
      a.line.localeCompare(b.line)
    );

  const dangerCount = rows.filter(r => r.condition === 'Danger').length;
  const warningCount = rows.filter(r => r.condition === 'Warning').length;

  // Export exactly what the table currently shows (filters + sort applied)
  const handleExport = () => exportToExcel(
    visible.map((r, i) => ({
      '#': i + 1,
      'Area': r.line,
      'Functional Location': r.section,
      'Machine': r.equipment,
      'Condition': r.condition,
      'Finding': r.finding ?? '',
      'Recommendation': r.recommendation ?? '',
      'Generated TAG': r.generatedTag ?? '',
      'SAP No': r.sapNo ?? '',
      'WO Text': r.woText ?? '',
      'Bearings Info': r.bearingsInfo ?? '',
      'Comments': r.comments ?? '',
      'Work Order': r.woNumber ?? '',
      'Created': fmtDate(r.creationDate),
      'Status': STATUS_LABEL[r.status],
    })),
    'Findings',
    'findings',
  );

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-gray-400 gap-3">
        <Building2 size={36} className="opacity-30" />
        <p className="text-sm">Select a company to view findings</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Findings List</h1>
          <p className="text-sm text-gray-500 mt-0.5">Assets currently at Warning or Danger.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-100 text-red-700">{dangerCount} Danger</span>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-orange-100 text-orange-700">{warningCount} Warning</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search asset, tag, area…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select value={filterLine} onChange={e => setFilterLine(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
          <option value="">All areas</option>
          {lineOptions.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={filterCondition} onChange={e => setFilterCondition(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
          <option value="">All conditions</option>
          <option value="Danger">Danger</option>
          <option value="Warning">Warning</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="wo_created">WO Created</option>
        </select>
        <span className="text-xs text-gray-500 px-3 py-2 border border-gray-200 rounded-lg bg-white">
          <strong className="text-gray-800">{visible.length}</strong> findings
        </span>
        <button
          onClick={handleExport}
          disabled={visible.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export the current list to Excel"
        >
          <Download size={14} /> Export
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowNotify(true)}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Email the selected findings to IME admins, company admins, and plant managers"
          >
            <Mail size={14} /> Notify{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
        ) : (
          <table className="w-full border-collapse text-[13px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                {isAdmin && (
                  <th className="pl-3 pr-1 py-3">
                    <input
                      type="checkbox"
                      checked={visible.length > 0 && visible.every(r => selectedIds.has(r.id))}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(visible.map(r => r.id)) : new Set())}
                      className="cursor-pointer accent-primary"
                      title="Select all visible"
                    />
                  </th>
                )}
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">Area</th>
                <th className="px-3 py-3 text-left">Functional Location</th>
                <th className="px-3 py-3 text-left">Machine</th>
                <th className="px-3 py-3 text-left">Condition</th>
                <th className="px-3 py-3 text-left">Recommendation</th>
                <th className="px-3 py-3 text-left">Generated TAG</th>
                <th className="px-3 py-3 text-left">Work Order</th>
                <th className="px-3 py-3 text-left">Created</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={isAdmin ? 12 : 11} className="text-center py-12 text-sm text-gray-400">No findings match your filters</td></tr>
              ) : visible.map((r, i) => (
                <tr key={r.id} onClick={() => openFinding(r)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors">
                  {isAdmin && (
                    <td className="pl-3 pr-1 py-2.5" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(r.id)}
                        onChange={() => toggleSelected(r.id)}
                        className="cursor-pointer accent-primary"
                      />
                    </td>
                  )}
                  <td className="px-3 py-2.5 text-gray-300 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.line}</td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-[160px] truncate">{r.section}</td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-gray-800">{r.equipment}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${CONDITION_BADGE[r.condition]}`}>{r.condition}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-[220px] truncate">
                    {r.recommendation || <span className="text-gray-300 italic">— none —</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{r.generatedTag ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">
                    {r.woNumber ? <span className="text-primary font-semibold">{r.woNumber}</span> : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{fmtDate(r.creationDate)}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    {r.notifiedAt && (
                      <span className="flex items-center gap-1 text-[10px] text-gray-400 mt-0.5" title={`Notified ${fmtDate(r.notifiedAt)}`}>
                        <BellRing size={10} /> Notified {fmtDate(r.notifiedAt)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canCreateWO && r.status === 'open' && r.recommendation?.trim() && (
                      <button
                        onClick={e => { e.stopPropagation(); openFinding(r, true); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary-light"
                        title="Create work order"
                      >
                        <ClipboardPlus size={12} /> WO
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <FindingModal
          finding={selected}
          isAdmin={isAdmin}
          canCreateWO={canCreateWO}
          defaultShowWO={startWO}
          userId={user?.id ?? null}
          companyId={selectedCompanyId}
          onClose={() => setSelected(null)}
          onViewWorkOrder={() => { setSelected(null); navigate('/work-orders'); }}
          onSaved={() => { setSelected(null); fetchData(); }}
        />
      )}

      {showNotify && (
        <NotifyModal
          findings={rows.filter(r => selectedIds.has(r.id))}
          companyId={selectedCompanyId}
          locationId={selectedLocationId}
          locations={locations as { id: string; name: string }[]}
          onClose={() => setShowNotify(false)}
          onSent={() => { setShowNotify(false); fetchData(); }}
        />
      )}
    </div>
  );
}

// ── Detail / edit modal ─────────────────────────────────────────────────────────

function FindingModal({
  finding, isAdmin, canCreateWO, defaultShowWO, userId, companyId, onClose, onSaved, onViewWorkOrder,
}: {
  finding: FindingRow;
  isAdmin: boolean;
  canCreateWO: boolean;
  defaultShowWO: boolean;
  userId: string | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
  onViewWorkOrder: () => void;
}) {
  const [recommendation, setRecommendation] = useState(finding.recommendation ?? '');
  const [findingText, setFindingText]       = useState(finding.finding ?? '');
  const [bearingsInfo, setBearingsInfo]     = useState(finding.bearingsInfo ?? '');
  const [sapNo, setSapNo]                   = useState(finding.sapNo ?? '');
  const [comments, setComments]             = useState(finding.comments ?? '');
  const [saving, setSaving] = useState(false);
  const [showWO, setShowWO] = useState(defaultShowWO);
  const [woError, setWoError] = useState<string | null>(null);

  // The specific measurement points driving this asset-level finding (the ones
  // whose latest reading is Warning/Danger), e.g. "NDE · Gearbox".
  const [pointsInAlarm, setPointsInAlarm] = useState<{ id: string; name: string; component: string; condition: string }[] | null>(null);
  useEffect(() => {
    if (!finding.equipmentId) { setPointsInAlarm([]); return; }
    let cancelled = false;
    (async () => {
      const { data: comps } = await supabase
        .from('components')
        .select('name, measurement_points ( id, name )')
        .eq('equipment_id', finding.equipmentId);
      const pts = ((comps ?? []) as unknown as { name: string; measurement_points: { id: string; name: string }[] }[])
        .flatMap(c => (c.measurement_points ?? []).map(p => ({ id: p.id, name: p.name, component: c.name })));
      if (pts.length === 0) { if (!cancelled) setPointsInAlarm([]); return; }
      const { data: meas } = await supabase
        .from('measurements')
        .select('measurement_point_id, alarm_level, measured_at')
        .in('measurement_point_id', pts.map(p => p.id))
        .order('measured_at', { ascending: false });
      const latest = new Map<string, string>();
      for (const m of (meas ?? []) as { measurement_point_id: string; alarm_level: string }[]) {
        if (!latest.has(m.measurement_point_id)) latest.set(m.measurement_point_id, m.alarm_level);
      }
      const inAlarm = pts
        .map(p => ({ ...p, condition: latest.get(p.id) ?? 'Normal' }))
        .filter(p => p.condition === 'Warning' || p.condition === 'Danger')
        .sort((a, b) => (a.condition === b.condition ? 0 : a.condition === 'Danger' ? -1 : 1));
      if (!cancelled) setPointsInAlarm(inAlarm);
    })();
    return () => { cancelled = true; };
  }, [finding.equipmentId]);

  // Work-order form
  const [woTitle, setWoTitle]   = useState(finding.woText ?? `PdM Finding - ${finding.equipment}`);
  const [woDesc, setWoDesc]     = useState(
    `${finding.condition} on ${finding.line} / ${finding.section} / ${finding.equipment}.` +
    (finding.finding ? `\nFinding: ${finding.finding}` : '')
  );
  const [woPriority, setWoPriority] = useState(finding.condition === 'Danger' ? 'high' : 'medium');
  const [woAssignee, setWoAssignee] = useState('');
  const [woDue, setWoDue]           = useState('');
  const [woSap, setWoSap]           = useState(finding.sapNo ?? '');

  // When the analyst fills (or changes) the recommendation, record it as an
  // asset-timeline event. Written to equipment_notes so it survives the
  // finding later recovering and being deleted by reconcile_findings().
  const logRecommendationNote = async () => {
    const rec = recommendation.trim();
    if (!rec || rec === (finding.recommendation ?? '').trim() || !finding.equipmentId) return;
    await supabase.from('equipment_notes').insert({
      equipment_id: finding.equipmentId,
      note_type: 'recommendation',
      message: rec,
      metadata: {
        finding_id: finding.id,
        condition: finding.condition,
      },
    });
  };

  const saveFields = async () => {
    setSaving(true);
    await supabase.from('findings').update({
      recommendation: recommendation || null,
      finding: findingText || null,
      bearings_info: bearingsInfo || null,
      sap_no: sapNo || null,
      comments: comments || null,
      updated_at: new Date().toISOString(),
    }).eq('id', finding.id);
    await logRecommendationNote();
    setSaving(false);
    onSaved();
  };

  const createWorkOrder = async () => {
    setWoError(null);
    // A recommendation must exist before ANY work order can be created. Only
    // ime_admins can write it, so a manager simply can't create the WO until an
    // analyst has added the recommendation.
    if (!recommendation.trim()) {
      setWoError(isAdmin
        ? 'Fill out the expert recommendation before creating a work order (use Back to edit it).'
        : 'This finding needs an IME analyst’s recommendation before a work order can be created.');
      return;
    }
    setSaving(true);

    // One active WO per asset — the old one must be closed first
    if (finding.equipmentId) {
      const { data: existing } = await supabase
        .from('work_orders')
        .select('wo_number')
        .eq('equipment_id', finding.equipmentId)
        .in('status', ['open', 'in_progress']);
      if (existing && existing.length > 0) {
        setWoError(`This asset already has an active work order (${existing.map(e => e.wo_number).join(', ')}). Close it before creating a new one.`);
        setSaving(false);
        return;
      }
    }

    const { data: wo, error } = await supabase.from('work_orders').insert({
      company_id: companyId,
      location_id: finding.locationId,
      equipment_id: finding.equipmentId,
      finding_id: finding.id,
      title: woTitle,
      description: woDesc,
      priority: woPriority,
      status: 'open',
      assignee: woAssignee || null,
      sap_no: woSap || null,
      due_date: woDue || null,
      created_by: userId,
      // KPI: mean time from notification email → WO creation. Copied here so
      // it survives the finding later being deleted by reconcile_findings().
      finding_notified_at: finding.notifiedAt,
    }).select('id').single();

    if (error) {
      // 23505 = the DB trigger blocked a second active WO (race safety net)
      setWoError((error as { code?: string }).code === '23505'
        ? 'This asset already has an active work order. Close it before creating a new one.'
        : `Could not create work order: ${(error as { message?: string }).message ?? 'unknown error'}`);
      setSaving(false);
      return;
    }

    if (wo) {
      await supabase.from('findings').update({
        status: 'wo_created',
        work_order_id: wo.id,
        wo_text: woTitle,
        sap_no: woSap || null,
        // only ime_admins own the recommendation; don't let a manager blank it
        ...(isAdmin ? { recommendation: recommendation || null } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', finding.id);
      if (isAdmin) await logRecommendationNote();
    }
    setSaving(false);
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${CONDITION_BADGE[finding.condition]}`}>{finding.condition}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_BADGE[finding.status]}`}>{STATUS_LABEL[finding.status]}</span>
              {finding.woNumber && <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary font-mono">{finding.woNumber}</span>}
            </div>
            <h2 className="text-base font-bold text-gray-900 mt-1.5 font-mono">{finding.equipment}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{finding.line} / {finding.section}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {woError && (
            <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {woError}
            </div>
          )}
          {!showWO ? (
            <>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Points in alarm</p>
                {pointsInAlarm === null ? (
                  <p className="text-xs text-gray-300">Loading…</p>
                ) : pointsInAlarm.length === 0 ? (
                  <p className="text-xs text-gray-400">No measurement points currently in Warning or Danger.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {pointsInAlarm.map(p => (
                      <span key={p.id}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${p.condition === 'Danger' ? 'bg-red-50 text-red-700' : 'bg-orange-50 text-orange-700'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${p.condition === 'Danger' ? 'bg-red-500' : 'bg-orange-500'}`} />
                        {p.name} · {p.component}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <Field label="Recommendation (expert)">
                <textarea value={recommendation} onChange={e => setRecommendation(e.target.value)} disabled={!isAdmin}
                  rows={3} placeholder={isAdmin ? 'Enter recommendation…' : 'No recommendation yet'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500" />
              </Field>
              <Field label="Finding">
                <textarea value={findingText} onChange={e => setFindingText(e.target.value)} disabled={!isAdmin}
                  rows={2} placeholder={isAdmin ? 'Describe the finding…' : '—'}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Bearings Info">
                  <input value={bearingsInfo} onChange={e => setBearingsInfo(e.target.value)} disabled={!isAdmin}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500" />
                </Field>
                <Field label="SAP No.">
                  <input value={sapNo} onChange={e => setSapNo(e.target.value)} disabled={!isAdmin}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500" />
                </Field>
              </div>
              <Field label="Comments">
                <textarea value={comments} onChange={e => setComments(e.target.value)} disabled={!isAdmin}
                  rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-gray-50 disabled:text-gray-500" />
              </Field>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700 flex items-center gap-2"><ClipboardPlus size={15} className="text-primary" /> New Work Order</p>
              <Field label="Title">
                <input value={woTitle} onChange={e => setWoTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              </Field>
              <Field label="Description">
                <textarea value={woDesc} onChange={e => setWoDesc(e.target.value)} rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Priority">
                  <select value={woPriority} onChange={e => setWoPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="low">Low</option><option value="medium">Medium</option>
                    <option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </Field>
                <Field label="SAP No.">
                  <input value={woSap} onChange={e => setWoSap(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>
                <Field label="Assignee">
                  <input value={woAssignee} onChange={e => setWoAssignee(e.target.value)} placeholder="Optional"
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>
                <Field label="Due date">
                  <input type="date" value={woDue} onChange={e => setWoDue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20" />
                </Field>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {canCreateWO && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
            {showWO ? (
              <>
                <button onClick={() => { setShowWO(false); setWoError(null); }} className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100">Back</button>
                <button onClick={createWorkOrder} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPlus size={14} />} Create Work Order
                </button>
              </>
            ) : (
              <>
                {isAdmin && (
                  <button onClick={saveFields} disabled={saving}
                    className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                )}
                {finding.workOrderId ? (
                  <button onClick={onViewWorkOrder}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/5">
                    <ExternalLink size={14} /> View {finding.woNumber}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (!recommendation.trim()) {
                        setWoError(isAdmin
                          ? 'Fill out the expert recommendation before creating a work order.'
                          : 'This finding needs an IME analyst’s recommendation before a work order can be created.');
                        return;
                      }
                      setWoError(null);
                      setShowWO(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light">
                    <ClipboardPlus size={14} /> New Work Order
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{label}</p>
      {children}
    </div>
  );
}

// ── Notify modal — email selected findings to chosen recipients ────────────────

interface Recipient {
  id: string;
  email: string;
  full_name: string | null;
  role: 'ime_admin' | 'company_admin' | 'plant_manager';
  location_id: string | null;
}

const RECIPIENT_GROUPS: { role: Recipient['role']; label: string }[] = [
  { role: 'ime_admin',     label: 'IME Admins' },
  { role: 'company_admin', label: 'Company Admins' },
  { role: 'plant_manager', label: 'Plant Managers' },
];

function NotifyModal({ findings, companyId, locationId, locations, onClose, onSent }: {
  findings: FindingRow[];
  companyId: string;
  locationId: string | null;
  locations: { id: string; name: string }[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [recipients, setRecipients]   = useState<Recipient[]>([]);
  const [loadingRec, setLoadingRec]   = useState(true);
  const [checked, setChecked]         = useState<Set<string>>(new Set());
  const [note, setNote]               = useState('');
  const [sending, setSending]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Eligible recipients: every IME admin + this company's company admins
      // and plant managers (scoped to the selected plant when one is set).
      const { data } = await supabase
        .from('profiles')
        .select('id, email, full_name, role, location_id')
        .or(`role.eq.ime_admin,and(company_id.eq.${companyId},role.in.(company_admin,plant_manager))`);
      const all = ((data ?? []) as Recipient[]).filter(p =>
        p.email && (p.role !== 'plant_manager' || !locationId || p.location_id === locationId)
      );
      setRecipients(all);
      setLoadingRec(false);
    })();
  }, [companyId, locationId]);

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleGroup = (ids: string[], on: boolean) => setChecked(prev => {
    const next = new Set(prev);
    ids.forEach(id => on ? next.add(id) : next.delete(id));
    return next;
  });

  const locName = (id: string | null) => locations.find(l => l.id === id)?.name ?? '';

  const send = async () => {
    setError(null);
    setSending(true);
    const { data, error: fnError } = await supabase.functions.invoke('notify-findings', {
      body: {
        findingIds: findings.map(f => f.id),
        recipientIds: Array.from(checked),
        note: note.trim() || null,
      },
    });
    const failed = fnError || (data as { error?: string })?.error;
    if (failed) {
      setError(typeof failed === 'string' ? failed : 'Failed to send notification. Please try again.');
      setSending(false);
      return;
    }
    setSending(false);
    onSent();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2"><Mail size={16} className="text-primary" /> Notify findings</h2>
            <p className="text-xs text-gray-400 mt-0.5">{findings.length} finding{findings.length !== 1 ? 's' : ''} selected · email sent from the platform</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {error && (
            <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
          )}

          {/* Selected findings summary */}
          <div className="rounded-xl border border-gray-100 divide-y divide-gray-50 max-h-36 overflow-y-auto">
            {findings.map(f => (
              <div key={f.id} className="px-3 py-1.5 flex items-center gap-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${CONDITION_BADGE[f.condition]}`}>{f.condition}</span>
                <span className="font-mono font-semibold text-gray-700">{f.equipment}</span>
                <span className="text-gray-400 truncate">{f.line} · {f.section}</span>
                {f.notifiedAt && <span className="ml-auto text-[10px] text-gray-300 shrink-0">notified {fmtDate(f.notifiedAt)}</span>}
              </div>
            ))}
          </div>

          {/* Recipients */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">Recipients <span className="text-red-400">*</span></p>
            {loadingRec ? (
              <div className="flex justify-center py-6"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
            ) : (
              <div className="space-y-3">
                {RECIPIENT_GROUPS.map(g => {
                  const members = recipients.filter(r => r.role === g.role);
                  if (members.length === 0) return null;
                  const allOn = members.every(m => checked.has(m.id));
                  return (
                    <div key={g.role} className="rounded-xl border border-gray-100 overflow-hidden">
                      <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer">
                        <input type="checkbox" checked={allOn}
                          onChange={e => toggleGroup(members.map(m => m.id), e.target.checked)}
                          className="cursor-pointer accent-primary" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{g.label}</span>
                        <span className="text-[10px] text-gray-300">· {members.length}</span>
                      </label>
                      <div className="divide-y divide-gray-50">
                        {members.map(m => (
                          <label key={m.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50/40">
                            <input type="checkbox" checked={checked.has(m.id)} onChange={() => toggle(m.id)}
                              className="cursor-pointer accent-primary" />
                            <span className="text-sm text-gray-700">{m.full_name?.trim() || m.email}</span>
                            <span className="text-xs text-gray-400 truncate">{m.email}</span>
                            {m.role === 'plant_manager' && m.location_id && (
                              <span className="ml-auto text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">{locName(m.location_id)}</span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {recipients.length === 0 && <p className="text-xs text-gray-400">No eligible recipients found.</p>}
              </div>
            )}
          </div>

          {/* Optional message */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Message <span className="text-gray-300 font-normal normal-case">(optional)</span></p>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Add context for the recipients…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100">Cancel</button>
          <button onClick={send} disabled={checked.size === 0 || sending}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-50">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send to {checked.size} recipient{checked.size !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
