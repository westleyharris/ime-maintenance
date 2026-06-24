import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, X, ClipboardPlus, Building2, ExternalLink,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useScope } from '../context/ScopeContext';
import { useAuth } from '../context/AuthContext';

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
  locationId: string | null;
  line: string;
  section: string;
  equipment: string;
  equipmentId: string | null;
  component: string;
  point: string;
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
  location_id: string | null;
  measurement_points: {
    name: string;
    components: {
      name: string;
      equipment: {
        id: string;
        tag: string;
        sections: { uas_name: string; lines: { name: string } } | null;
      } | null;
    } | null;
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
  const eq  = f.measurement_points?.components?.equipment;
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
    locationId: f.location_id,
    line: sec?.lines?.name ?? '—',
    section: sec?.uas_name ?? '—',
    equipment: eq?.tag ?? '—',
    equipmentId: eq?.id ?? null,
    component: f.measurement_points?.components?.name ?? '—',
    point: f.measurement_points?.name ?? '—',
  };
}

// ── Page ────────────────────────────────────────────────────────────────────────

export default function Findings() {
  const { selectedCompanyId, selectedLocationId } = useScope();
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === 'ime_admin';

  const navigate = useNavigate();
  const [rows, setRows]       = useState<FindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FindingRow | null>(null);
  const [startWO, setStartWO]   = useState(false);

  const [search, setSearch]           = useState('');
  const [filterLine, setFilterLine]   = useState('');
  const [filterCondition, setFilterCondition] = useState('');
  const [filterStatus, setFilterStatus]       = useState('');

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
        bearings_info, comments, creation_date, status, work_order_id, location_id,
        measurement_points (
          name,
          components ( name, equipment ( id, tag, sections ( uas_name, lines ( name ) ) ) )
        )
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
        if (!(`${r.equipment} ${r.component} ${r.point} ${r.generatedTag ?? ''} ${r.line} ${r.section}`
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
            placeholder="Search machine, point, tag…"
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
        ) : (
          <table className="w-full border-collapse text-[13px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                <th className="px-3 py-3 text-left">#</th>
                <th className="px-3 py-3 text-left">Area</th>
                <th className="px-3 py-3 text-left">Functional Location</th>
                <th className="px-3 py-3 text-left">Machine</th>
                <th className="px-3 py-3 text-left">Point</th>
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
                <tr><td colSpan={12} className="text-center py-12 text-sm text-gray-400">No findings match your filters</td></tr>
              ) : visible.map((r, i) => (
                <tr key={r.id} onClick={() => openFinding(r)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors">
                  <td className="px-3 py-2.5 text-gray-300 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 text-gray-600">{r.line}</td>
                  <td className="px-3 py-2.5 text-gray-500 max-w-[160px] truncate">{r.section}</td>
                  <td className="px-3 py-2.5 font-mono font-semibold text-gray-800">{r.equipment}</td>
                  <td className="px-3 py-2.5 text-gray-500">{r.point}</td>
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
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {isAdmin && r.status === 'open' && (
                      <button
                        onClick={e => { e.stopPropagation(); openFinding(r, true); }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-white text-[11px] font-semibold hover:bg-primary-light"
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
          defaultShowWO={startWO}
          userId={user?.id ?? null}
          companyId={selectedCompanyId}
          onClose={() => setSelected(null)}
          onViewWorkOrder={() => { setSelected(null); navigate('/work-orders'); }}
          onSaved={() => { setSelected(null); fetchData(); }}
        />
      )}
    </div>
  );
}

// ── Detail / edit modal ─────────────────────────────────────────────────────────

function FindingModal({
  finding, isAdmin, defaultShowWO, userId, companyId, onClose, onSaved, onViewWorkOrder,
}: {
  finding: FindingRow;
  isAdmin: boolean;
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

  // Work-order form
  const [woTitle, setWoTitle]   = useState(finding.woText ?? `PdM Finding - ${finding.equipment} ${finding.point}`);
  const [woDesc, setWoDesc]     = useState(
    `${finding.condition} on ${finding.line} / ${finding.section} / ${finding.equipment} / ${finding.point}.` +
    (finding.finding ? `\nFinding: ${finding.finding}` : '')
  );
  const [woPriority, setWoPriority] = useState(finding.condition === 'Danger' ? 'high' : 'medium');
  const [woAssignee, setWoAssignee] = useState('');
  const [woDue, setWoDue]           = useState('');
  const [woSap, setWoSap]           = useState(finding.sapNo ?? '');

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
    setSaving(false);
    onSaved();
  };

  const createWorkOrder = async () => {
    setSaving(true);
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
    }).select('id').single();

    if (!error && wo) {
      await supabase.from('findings').update({
        status: 'wo_created',
        work_order_id: wo.id,
        wo_text: woTitle,
        sap_no: woSap || null,
        recommendation: recommendation || null,
        updated_at: new Date().toISOString(),
      }).eq('id', finding.id);
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
            <h2 className="text-base font-bold text-gray-900 mt-1.5 font-mono">{finding.equipment} · {finding.point}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{finding.line} / {finding.section} / {finding.component}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4">
          {!showWO ? (
            <>
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
        {isAdmin && (
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 shrink-0">
            {showWO ? (
              <>
                <button onClick={() => setShowWO(false)} className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100">Back</button>
                <button onClick={createWorkOrder} disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <ClipboardPlus size={14} />} Create Work Order
                </button>
              </>
            ) : (
              <>
                <button onClick={saveFields} disabled={saving}
                  className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {finding.workOrderId ? (
                  <button onClick={onViewWorkOrder}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/5">
                    <ExternalLink size={14} /> View {finding.woNumber}
                  </button>
                ) : (
                  <button onClick={() => setShowWO(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light">
                    <ClipboardPlus size={14} /> New Work Order
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {!isAdmin && finding.workOrderId && (
          <div className="flex items-center justify-end px-6 py-3 border-t border-gray-100">
            <button onClick={onViewWorkOrder} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              <ExternalLink size={13} /> View {finding.woNumber}
            </button>
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
