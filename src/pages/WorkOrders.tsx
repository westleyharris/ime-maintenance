import { useState, useEffect, useCallback } from 'react';
import { Loader2, Trash2, Building2, ClipboardList, Download, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useScope } from '../context/ScopeContext';
import { useAuth } from '../context/AuthContext';
import { exportToExcel } from '../utils/exportExcel';

type WOStatus = 'open' | 'in_progress' | 'closed' | 'cancelled';
type Priority = 'low' | 'medium' | 'high' | 'critical';

interface WORow {
  id: string;
  woNumber: string;
  title: string | null;
  description: string | null;
  priority: Priority;
  status: WOStatus;
  assignee: string | null;
  sapNo: string | null;
  cmmsWoNo: string | null;
  closeNote: string | null;
  dueDate: string | null;
  createdAt: string;
  findingId: string | null;
  equipment: string;
  line: string;
  findingCondition: string | null;
}

interface RawWO {
  id: string;
  wo_number: string;
  title: string | null;
  description: string | null;
  priority: Priority;
  status: WOStatus;
  assignee: string | null;
  sap_no: string | null;
  cmms_wo_no: string | null;
  close_note: string | null;
  due_date: string | null;
  created_at: string;
  finding_id: string | null;
  equipment: { tag: string; sections: { lines: { name: string } } | null } | null;
}

const PRIORITY_BADGE: Record<Priority, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

const STATUS_BADGE: Record<WOStatus, string> = {
  open: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-purple-50 text-purple-700',
  closed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

const STATUS_LABEL: Record<WOStatus, string> = {
  open: 'To Be Scheduled', in_progress: 'In Progress', closed: 'Closed', cancelled: 'Cancelled',
};

// Preset closing reasons — picked from a dropdown when a WO is closed
// Closing reason = the confirmed root cause, grouped by component type. "No
// finding" lets them close without a root cause and just leave a follow-up note.
const CLOSE_REASON_GROUPS: { group: string; reasons: string[] }[] = [
  { group: 'Motor', reasons: [
    'Motor: Lubrication Deficiency (Insufficient or Degraded Lubrication)',
    'Motor: Early Bearing Fatigue',
    'Motor: Outer Race Fault',
    'Motor: Inner Race Fault',
    'Motor: Rolling Element Fault',
    'Motor: Cage Fault',
    'Motor: Advanced Bearing Damage',
    'Motor: Over-Lubrication',
  ] },
  { group: 'Gearbox', reasons: [
    'Gearbox: Abnormal Gear Wear',
    'Gearbox: Gear Mesh Fault',
    'Gearbox: Chipped Tooth',
    'Gearbox: Broken Tooth',
    'Gearbox: Excessive Backlash',
    'Gearbox: Under-Lubricated',
    'Gearbox: Over-Lubricated',
    'Gearbox: Contaminated Lubricant (dirt/debris)',
    'Gearbox: Burnt Odor',
    'Gearbox: Moisture Present',
    'Gearbox: Broken Seals',
    'Gearbox: Output Shaft Bent',
  ] },
  { group: 'Other', reasons: [
    'No finding',
    'Other',
  ] },
];

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${m}/${d}/${y}`;
}

export default function WorkOrders() {
  const { selectedCompanyId, selectedLocationId } = useScope();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ime_admin';
  // company_admin / plant_manager can also manage WOs; RLS enforces their scope.
  const canManage = isAdmin || profile?.role === 'company_admin' || profile?.role === 'plant_manager';

  const [rows, setRows] = useState<WORow[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailWO, setDetailWO] = useState<WORow | null>(null);
  const [filterStatus, setFilterStatus]     = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    if (!selectedCompanyId) { setRows([]); return; }
    setLoading(true);

    let q = supabase
      .from('work_orders')
      .select(`
        id, wo_number, title, description, priority, status, assignee, sap_no, cmms_wo_no, close_note, due_date, created_at, finding_id,
        equipment ( tag, sections ( lines ( name ) ) )
      `)
      .eq('company_id', selectedCompanyId)
      .order('created_at', { ascending: false });
    if (selectedLocationId) q = q.eq('location_id', selectedLocationId);
    const { data } = await q;

    // finding condition (separate fetch avoids the dual-FK ambiguity)
    const { data: fs } = await supabase
      .from('findings')
      .select('id, condition')
      .eq('company_id', selectedCompanyId);
    const fMap = new Map(((fs ?? []) as { id: string; condition: string }[]).map(f => [f.id, f.condition]));

    const flat: WORow[] = ((data ?? []) as unknown as RawWO[]).map(w => ({
      id: w.id, woNumber: w.wo_number, title: w.title, description: w.description,
      priority: w.priority, status: w.status, assignee: w.assignee, sapNo: w.sap_no,
      cmmsWoNo: w.cmms_wo_no, closeNote: w.close_note, dueDate: w.due_date, createdAt: w.created_at, findingId: w.finding_id,
      equipment: w.equipment?.tag ?? '—',
      line: w.equipment?.sections?.lines?.name ?? '—',
      findingCondition: w.finding_id ? (fMap.get(w.finding_id) ?? null) : null,
    }));
    setRows(flat);
    setLoading(false);
  }, [selectedCompanyId, selectedLocationId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Closing requires a note — intercept and open the close modal instead
  const [closingWO, setClosingWO] = useState<WORow | null>(null);

  const updateStatus = async (id: string, status: WOStatus) => {
    if (status === 'closed') {
      const wo = rows.find(r => r.id === id);
      if (wo) setClosingWO(wo);
      return;
    }
    await supabase.from('work_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    setRows(rs => rs.map(r => r.id === id ? { ...r, status } : r));
  };

  const confirmClose = async (id: string, note: string) => {
    await supabase.from('work_orders').update({
      status: 'closed',
      close_note: note,
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    setRows(rs => rs.map(r => r.id === id ? { ...r, status: 'closed' as WOStatus, closeNote: note } : r));
    setClosingWO(null);
  };

  // Manually-entered CMMS work order number — saved on blur / Enter
  const updateCmms = async (id: string, value: string) => {
    const cmms = value.trim() || null;
    await supabase.from('work_orders').update({ cmms_wo_no: cmms, updated_at: new Date().toISOString() }).eq('id', id);
    setRows(rs => rs.map(r => r.id === id ? { ...r, cmmsWoNo: cmms } : r));
  };

  const remove = async (id: string, findingId: string | null) => {
    if (!confirm('Delete this work order?')) return;
    await supabase.from('work_orders').delete().eq('id', id);
    if (findingId) await supabase.from('findings').update({ status: 'open', work_order_id: null }).eq('id', findingId);
    fetchData();
  };

  const visible = rows.filter(w => {
    if (filterStatus && w.status !== filterStatus) return false;
    if (filterPriority && w.priority !== filterPriority) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${w.woNumber} ${w.cmmsWoNo ?? ''} ${w.title ?? ''} ${w.equipment} ${w.assignee ?? ''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Export exactly what the table currently shows (filters applied)
  const handleExport = () => exportToExcel(
    visible.map(w => ({
      'WO #': w.woNumber,
      'CMMS WO #': w.cmmsWoNo ?? '',
      'Asset': w.equipment,
      'Line': w.line,
      'Title': w.title ?? '',
      'Description': w.description ?? '',
      'Finding Condition': w.findingCondition ?? '',
      'Priority': w.priority,
      'Status': STATUS_LABEL[w.status],
      'Assignee': w.assignee ?? '',
      'SAP No': w.sapNo ?? '',
      'Close Note': w.closeNote ?? '',
      'Due': fmtDate(w.dueDate),
      'Created': fmtDate(w.createdAt),
    })),
    'Work Orders',
    'work_orders',
  );

  if (!selectedCompanyId) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-gray-400 gap-3">
        <Building2 size={36} className="opacity-30" />
        <p className="text-sm">Select a company to view work orders</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Work Orders</h1>
          <p className="text-sm text-gray-500 mt-0.5">Created from findings and linked to assets.</p>
        </div>
        <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700">
          {rows.filter(w => w.status === 'open' || w.status === 'in_progress').length} active
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search WO #, title, asset…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20"
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
          <option value="">All statuses</option>
          <option value="open">To Be Scheduled</option><option value="in_progress">In Progress</option>
          <option value="closed">Closed</option><option value="cancelled">Cancelled</option>
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600">
          <option value="">All priorities</option>
          <option value="low">Low</option><option value="medium">Medium</option>
          <option value="high">High</option><option value="critical">Critical</option>
        </select>
        <span className="text-xs text-gray-500 px-3 py-2 border border-gray-200 rounded-lg bg-white">
          <strong className="text-gray-800">{visible.length}</strong> work orders
        </span>
        <button
          onClick={handleExport}
          disabled={visible.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Export the current list to Excel"
        >
          <Download size={14} /> Export
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-100 rounded-2xl bg-white shadow-sm">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-gray-300" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-2">
            <ClipboardList size={26} className="opacity-30" />
            <p className="text-sm">No work orders yet</p>
            <p className="text-xs">Create one from a finding in the Findings tab.</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-[13px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/60 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                <th className="px-3 py-3 text-left">WO #</th>
                <th className="px-3 py-3 text-left">CMMS WO #</th>
                <th className="px-3 py-3 text-left">Asset</th>
                <th className="px-3 py-3 text-left">Title</th>
                <th className="px-3 py-3 text-left">Finding</th>
                <th className="px-3 py-3 text-left">Priority</th>
                <th className="px-3 py-3 text-left">Status</th>
                <th className="px-3 py-3 text-left">Assignee</th>
                <th className="px-3 py-3 text-left">Due</th>
                <th className="px-3 py-3 text-left">Created</th>
                {canManage && <th className="px-3 py-3 text-right">Action</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(w => (
                <tr key={w.id} onClick={() => setDetailWO(w)}
                  className="border-b border-gray-50 hover:bg-blue-50/40 cursor-pointer transition-colors">
                  <td className="px-3 py-2.5 font-mono font-semibold text-primary">{w.woNumber}</td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    {canManage ? (
                      <input
                        key={`${w.id}-${w.cmmsWoNo ?? ''}`}
                        defaultValue={w.cmmsWoNo ?? ''}
                        placeholder="—"
                        onBlur={e => { if (e.target.value.trim() !== (w.cmmsWoNo ?? '')) updateCmms(w.id, e.target.value); }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        className="w-24 px-2 py-1 rounded-md border border-transparent hover:border-gray-200 focus:border-gray-300 font-mono text-xs text-gray-700 bg-transparent outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    ) : (
                      <span className="font-mono text-xs text-gray-600">{w.cmmsWoNo ?? '—'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono font-semibold text-gray-800">{w.equipment}</span>
                    <span className="block text-[10px] text-gray-400">{w.line}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-600 max-w-[240px] truncate" title={w.description ?? ''}>{w.title ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {w.findingCondition
                      ? <span className="text-xs text-gray-500">{w.findingCondition}</span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${PRIORITY_BADGE[w.priority]}`}>{w.priority}</span>
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    {canManage ? (
                      <select value={w.status} onChange={e => updateStatus(w.id, e.target.value as WOStatus)}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold border-0 cursor-pointer ${STATUS_BADGE[w.status]}`}>
                        <option value="open">To Be Scheduled</option><option value="in_progress">In Progress</option>
                        <option value="closed">Closed</option><option value="cancelled">Cancelled</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_BADGE[w.status]}`}>{STATUS_LABEL[w.status]}</span>
                    )}
                    {w.status === 'closed' && w.closeNote && (
                      <span className="block text-[10px] text-gray-400 mt-0.5 max-w-[160px] truncate" title={w.closeNote}>{w.closeNote}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-gray-500">{w.assignee ?? '—'}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{fmtDate(w.dueDate)}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{fmtDate(w.createdAt)}</td>
                  {canManage && (
                    <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => remove(w.id, w.findingId)} className="p-1.5 text-gray-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailWO && (
        <WODetailModal wo={detailWO} onClose={() => setDetailWO(null)} />
      )}

      {closingWO && (
        <CloseWOModal
          wo={closingWO}
          onCancel={() => setClosingWO(null)}
          onConfirm={note => confirmClose(closingWO.id, note)}
        />
      )}
    </div>
  );
}

// ── Detail popup — full work order at a glance ────────────────────────────────

function WODetailModal({ wo, onClose }: { wo: WORow; onClose: () => void }) {
  const rows: [string, React.ReactNode][] = [
    ['CMMS WO #', wo.cmmsWoNo ?? '—'],
    ['Asset', <span className="font-mono font-semibold text-gray-800">{wo.equipment}</span>],
    ['Area', wo.line],
    ['Finding', wo.findingCondition ?? '—'],
    ['Priority', <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${PRIORITY_BADGE[wo.priority]}`}>{wo.priority}</span>],
    ['Status', <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_BADGE[wo.status]}`}>{STATUS_LABEL[wo.status]}</span>],
    ['Assignee', wo.assignee ?? '—'],
    ['SAP No.', wo.sapNo ?? '—'],
    ['Due date', fmtDate(wo.dueDate)],
    ['Created', fmtDate(wo.createdAt)],
  ];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] shadow-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-base font-bold text-primary">{wo.woNumber}</span>
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_BADGE[wo.status]}`}>{STATUS_LABEL[wo.status]}</span>
            </div>
            <h2 className="text-base font-bold text-gray-900 mt-1.5">{wo.title ?? 'Work order'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">{label}</dt>
                <dd className="text-sm text-gray-700">{value}</dd>
              </div>
            ))}
          </dl>

          {wo.description && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">{wo.description}</p>
            </div>
          )}

          {wo.status === 'closed' && wo.closeNote && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1">Closing note</p>
              <p className="text-sm text-gray-700 rounded-lg bg-green-50 border border-green-100 px-3 py-2">{wo.closeNote}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Close modal — a closing note is required ──────────────────────────────────

function CloseWOModal({ wo, onCancel, onConfirm }: {
  wo: WORow;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [reason, setReason]   = useState('');
  const [details, setDetails] = useState('');
  const [saving, setSaving]   = useState(false);

  // "Other" needs free text; presets can optionally add detail
  const valid = reason !== '' && (reason !== 'Other' || details.trim() !== '');

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    const note = reason === 'Other'
      ? details.trim()
      : details.trim() ? `${reason} — ${details.trim()}` : reason;
    await onConfirm(note);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-6" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Close {wo.woNumber}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{wo.equipment} · {wo.title ?? 'Work order'}</p>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Closing reason (root cause) <span className="text-red-400">*</span></p>
            <select value={reason} onChange={e => setReason(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white outline-none focus:ring-2 focus:ring-primary/20">
              <option value="">Select a reason…</option>
              {CLOSE_REASON_GROUPS.map(g => (
                <optgroup key={g.group} label={g.group}>
                  {g.reasons.map(r => <option key={r} value={r}>{r}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
              Details {reason === 'Other' ? <span className="text-red-400">*</span> : <span className="text-gray-300 font-normal normal-case">(optional)</span>}
            </p>
            <textarea value={details} onChange={e => setDetails(e.target.value)} rows={3}
              placeholder={reason === 'Other' ? 'Describe what was done…' : 'Anything worth noting…'}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-sm font-semibold text-gray-500 hover:bg-gray-100">Cancel</button>
          <button onClick={submit} disabled={!valid || saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary-light disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null} Close Work Order
          </button>
        </div>
      </div>
    </div>
  );
}
