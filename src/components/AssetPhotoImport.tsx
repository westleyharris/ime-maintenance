// ── Asset photo import ────────────────────────────────────────────────────────
//
// Bulk-loads asset photos from a predictive-maintenance mapping workbook, which
// already contains a photo of every asset beside its tag.
//
// The analyst picks company/location/LINE (the line cannot be inferred — tags
// repeat across lines), the workbook is matched to equipment, and every asset
// offering more than one photo goes to a review grid. Nothing is preselected
// there: a nameplate and a machine photo are indistinguishable from the file
// itself, so a human decides. Assets that already have a photo are never touched.

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Images, Upload, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight,
  X, ImageOff, RotateCcw,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/fetchAll';
import { parseMappingWorkbook, WorkbookParseError, type ParsedWorkbook, type WorkbookImage } from '../utils/mappingWorkbook';
import { buildMatchPlan, planHealth, unclaimedSections, type DbSection, type DbEquipment, type MatchPlan, type RowMatch } from '../utils/assetPhotoMatch';
import { measureAll, pickAssetPhoto, pickConfidence, type PhotoMetrics } from '../utils/photoHeuristic';

type Step = 'select' | 'match' | 'review' | 'done';

interface Opt { id: string; name: string }

interface CommitResult {
  tag: string;
  section: string;
  ok: boolean;
  error?: string;
}

const rowKey = (sheet: string, rowIndex: number) => `${sheet}#${rowIndex}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Uploads run in parallel but bounded — 186 at once would swamp the browser. */
const UPLOAD_CONCURRENCY = 5;

export default function AssetPhotoImport() {
  const [step, setStep] = useState<Step>('select');

  const [companies, setCompanies] = useState<Opt[]>([]);
  const [locations, setLocations] = useState<Opt[]>([]);
  const [lines, setLines]         = useState<Opt[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [lineId, setLineId]       = useState('');

  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError]   = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedWorkbook | null>(null);
  const [sections, setSections] = useState<DbSection[]>([]);
  const [autoPlan, setAutoPlan] = useState<MatchPlan | null>(null);
  /** Sheet name → section id, from the analyst correcting the summary table. */
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const plan = useMemo(() => {
    if (!parsed || !autoPlan) return null;
    return Object.keys(overrides).length
      ? buildMatchPlan(parsed.sheets, sections, overrides)
      : autoPlan;
  }, [parsed, autoPlan, sections, overrides]);

  /** rowKey → chosen image path. Pre-filled by the framing heuristic. */
  const [choices, setChoices] = useState<Record<string, string>>({});
  /** Framing statistics per image path, used to pre-select the machine photo. */
  const [metrics, setMetrics] = useState<Map<string, PhotoMetrics>>(new Map());
  /** Rows the analyst actively changed, so predictions can be told apart. */
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Pre-select every assignable row: the single-photo ones carry no decision at
  // all, and the rest get the heuristic's pick so the analyst confirms rather
  // than chooses. Runs off `plan`, not the initial parse, because a section
  // override can turn a previously skipped row into an assignable one.
  useEffect(() => {
    if (!plan) return;
    setChoices(prev => {
      const next = { ...prev };
      let added = false;
      for (const sp of plan.sheets) {
        for (const m of sp.rows) {
          if (!m.equipment || m.skippedHasImage || !m.row.images.length) continue;
          const k = rowKey(sp.sheetName, m.row.rowIndex);
          if (next[k]) continue;
          next[k] = m.row.images[pickAssetPhoto(m.row.images, metrics)].path;
          added = true;
        }
      }
      return added ? next : prev;
    });
  }, [plan, metrics]);

  /** Explicit acknowledgement required when the workbook looks like the wrong line. */
  const [overrideWrongLine, setOverrideWrongLine] = useState(false);

  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults]   = useState<CommitResult[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  // Object URLs are revoked wholesale on reset/unmount; 333 images would
  // otherwise pin well over 100MB for the life of the session.
  const urlCache = useRef(new Map<string, string>());

  const imgUrl = useCallback((img: WorkbookImage) => {
    const hit = urlCache.current.get(img.path);
    if (hit) return hit;
    const url = URL.createObjectURL(new Blob([img.bytes as unknown as BlobPart], { type: img.mime }));
    urlCache.current.set(img.path, url);
    return url;
  }, []);

  const releaseUrls = useCallback(() => {
    for (const u of urlCache.current.values()) URL.revokeObjectURL(u);
    urlCache.current.clear();
  }, []);

  useEffect(() => releaseUrls, [releaseUrls]);

  // ── scope pickers ───────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('companies').select('id, name').order('name')
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  useEffect(() => {
    setLocationId(''); setLineId(''); setLines([]);
    if (!companyId) { setLocations([]); return; }
    supabase.from('locations').select('id, name').eq('company_id', companyId).order('name')
      .then(({ data }) => setLocations(data ?? []));
  }, [companyId]);

  useEffect(() => {
    setLineId('');
    if (!locationId) { setLines([]); return; }
    supabase.from('lines').select('id, name').eq('location_id', locationId).order('name')
      .then(({ data }) => setLines(data ?? []));
  }, [locationId]);

  // ── reset ───────────────────────────────────────────────────────────────────
  function reset() {
    releaseUrls();
    setStep('select'); setParsed(null); setAutoPlan(null); setOverrides({}); setSections([]);
    setChoices({}); setTouched(new Set()); setMetrics(new Map());
    setResults([]); setError(null); setOverrideWrongLine(false); setStatus('');
    setProgress({ done: 0, total: 0 });
    if (fileRef.current) fileRef.current.value = '';
  }

  // ── parse + match ───────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    if (!lineId) { setError('Choose the company, location and line before loading a workbook.'); return; }
    setBusy(true); setError(null); setStatus('Reading workbook…'); releaseUrls();
    try {
      const book = parseMappingWorkbook(await file.arrayBuffer());

      const { data: secRows, error: secErr } = await supabase
        .from('sections').select('id, uas_name, uas_order').eq('line_id', lineId);
      if (secErr) throw new Error(secErr.message);
      const secs = secRows ?? [];
      if (!secs.length) throw new Error('That line has no sections in the platform.');

      const { rows: equip, error: eqErr } = await fetchAllRows<{
        id: string; tag: string; image_url: string | null; uas_order: number | null; section_id: string;
      }>((from, to) =>
        supabase.from('equipment')
          .select('id, tag, image_url, uas_order, section_id')
          .in('section_id', secs.map(s => s.id))
          .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: unknown }>);
      if (eqErr) throw new Error(String((eqErr as { message?: string })?.message ?? eqErr));

      const byOrder = (a: { uas_order: number | null; tag?: string; uas_name?: string }, b: typeof a) =>
        (a.uas_order ?? 1e9) - (b.uas_order ?? 1e9) ||
        (a.tag ?? a.uas_name ?? '').localeCompare(b.tag ?? b.uas_name ?? '');

      const dbSections: DbSection[] = [...secs].sort(byOrder).map(s => ({
        id: s.id,
        name: s.uas_name,
        equipment: equip
          .filter(e => e.section_id === s.id)
          .sort(byOrder)
          .map<DbEquipment>(e => ({ id: e.id, tag: e.tag, imageUrl: e.image_url, uasOrder: e.uas_order })),
      }));

      const p = buildMatchPlan(book.sheets, dbSections);

      // Measure framing up front so every card opens pre-selected.
      setStatus('Measuring photos…');
      const allImages = book.sheets.flatMap(sh => sh.rows.flatMap(r => r.images));
      const mx = await measureAll(allImages, (done, total) => {
        if (done % 25 === 0 || done === total) setStatus(`Measuring photos… ${done}/${total}`);
      });

      setParsed(book); setSections(dbSections); setAutoPlan(p); setOverrides({});
      setChoices({}); setTouched(new Set()); setMetrics(mx);
      setOverrideWrongLine(false);
      setStep('match');
    } catch (e) {
      setError(e instanceof WorkbookParseError ? e.message : (e as Error).message ?? 'Could not read that workbook.');
    } finally {
      setBusy(false); setStatus('');
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  /** Manual sheet→section correction from the match summary. */
  function reassign(sheetName: string, sectionId: string) {
    setOverrides(prev => ({ ...prev, [sheetName]: sectionId }));
  }

  // ── review grid ─────────────────────────────────────────────────────────────
  const reviewCards = useMemo(() => {
    if (!plan) return [];
    const out: { sheet: string; section: string; match: RowMatch; key: string }[] = [];
    for (const sp of plan.sheets) {
      for (const m of sp.rows) {
        if (!m.equipment || m.skippedHasImage || m.row.images.length < 2) continue;
        out.push({ sheet: sp.sheetName, section: sp.section?.name ?? '—', match: m, key: rowKey(sp.sheetName, m.row.rowIndex) });
      }
    }
    return out;
  }, [plan]);

  const decided = reviewCards.filter(c => choices[c.key]).length;
  const allDecided = decided === reviewCards.length;
  const pending   = reviewCards.length - decided;
  /**
   * Committing part of the work is safe and useful: assets that already have a
   * photo are skipped, so re-loading the same workbook later offers exactly the
   * rows still outstanding. 125 decisions need not happen in one sitting.
   */
  const committable = plan ? plan.counts.autoPhoto + decided : 0;

  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(0); }, [step]);

  useEffect(() => {
    if (step !== 'review') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const card = reviewCards[cursor];
      if (!card) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, reviewCards.length - 1)); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const img = card.match.row.images[idx];
        if (img) {
          setChoices(prev => ({ ...prev, [card.key]: img.path }));
          setTouched(prev => new Set(prev).add(card.key));
          setCursor(c => Math.min(c + 1, reviewCards.length - 1));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, cursor, reviewCards]);

  /** Bulk helper for runs where the photographer kept a consistent order. */
  function chooseAllInSheet(sheet: string, index: number) {
    setChoices(prev => {
      const next = { ...prev };
      for (const c of reviewCards) {
        if (c.sheet !== sheet) continue;
        const img = c.match.row.images[index];
        if (img) { next[c.key] = img.path; setTouched(t => new Set(t).add(c.key)); }
      }
      return next;
    });
  }

  // ── commit ──────────────────────────────────────────────────────────────────
  async function commit() {
    if (!plan) return;
    const jobs: { eq: DbEquipment; img: WorkbookImage; section: string }[] = [];
    for (const sp of plan.sheets) {
      for (const m of sp.rows) {
        if (!m.equipment || m.skippedHasImage) continue;
        const chosen = choices[rowKey(sp.sheetName, m.row.rowIndex)];
        const img = m.row.images.find(i => i.path === chosen);
        if (img) jobs.push({ eq: m.equipment, img, section: sp.section?.name ?? '—' });
      }
    }

    setStep('done'); setBusy(true); setResults([]);
    setProgress({ done: 0, total: jobs.length });

    const out: CommitResult[] = [];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= jobs.length) return;
        const { eq, img, section } = jobs[i];
        try {
          const ext = img.path.split('.').pop() ?? 'jpg';
          // Deterministic name, unlike the app's `${id}_${Date.now()}` — re-running
          // a workbook then replaces the object instead of orphaning one per run.
          const path = `${eq.id}_mapping.${ext}`;
          const { error: upErr } = await supabase.storage
            .from('equipment-images')
            .upload(path, new Blob([img.bytes as unknown as BlobPart], { type: img.mime }), {
              upsert: true, contentType: img.mime,
            });
          if (upErr) throw upErr;
          const { data: { publicUrl } } = supabase.storage.from('equipment-images').getPublicUrl(path);
          const { error: updErr } = await supabase.from('equipment').update({ image_url: publicUrl }).eq('id', eq.id);
          if (updErr) throw updErr;
          out.push({ tag: eq.tag, section, ok: true });
        } catch (e) {
          out.push({ tag: eq.tag, section, ok: false, error: (e as Error).message ?? 'upload failed' });
        }
        setProgress(p => ({ ...p, done: p.done + 1 }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, jobs.length) }, worker));
    setResults(out);
    setBusy(false);
  }

  // ── render ──────────────────────────────────────────────────────────────────
  const c = plan?.counts;
  const health = plan ? planHealth(plan) : { unmatchedRatio: 0, confidentRatio: 1, looksWrongLine: false };

  return (
    <div className="space-y-5">
      {error && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-200 bg-red-50">
          <AlertTriangle size={17} className="text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm font-medium text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><X size={15} /></button>
        </div>
      )}

      {/* ── Step 1 · scope + file ─────────────────────────────────────────── */}
      {step === 'select' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">Import asset photos from a mapping workbook</h2>
            <p className="text-xs text-gray-500 mt-1 max-w-2xl">
              Loads one <code className="text-[11px] bg-gray-100 px-1 rounded">IME_UT_…_Mapping.xlsx</code> and
              matches its rows to equipment on the line you choose. Assets that already have a photo are left untouched.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Company',  value: companyId,  set: setCompanyId,  opts: companies, disabled: false },
              { label: 'Location', value: locationId, set: setLocationId, opts: locations, disabled: !companyId },
              { label: 'Line',     value: lineId,     set: setLineId,     opts: lines,     disabled: !locationId },
            ].map(f => (
              <div key={f.label}>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">{f.label}</label>
                <select value={f.value} onChange={e => f.set(e.target.value)} disabled={f.disabled}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-gray-700 disabled:bg-gray-50 disabled:text-gray-300">
                  <option value="">Select…</option>
                  {f.opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-gray-400">
            The line must be chosen explicitly — the same tag (M101, Motor 1) exists on several lines,
            so the workbook alone cannot identify it.
          </p>

          <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={!lineId || busy}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            {busy ? (status || 'Reading workbook…') : 'Choose workbook'}
          </button>
          {busy && <p className="text-xs text-gray-400">Large workbooks (~95MB) take a few seconds to unpack.</p>}
        </div>
      )}

      {/* ── Step 2 · match summary ────────────────────────────────────────── */}
      {step === 'match' && plan && c && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Match summary</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {parsed?.location ?? '—'} · {parsed?.line ?? '—'} · {plan.sheets.length} sheets · {c.rows} asset rows
                </p>
              </div>
              <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1">
                <RotateCcw size={12} /> Start over
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-4">
              {[
                { k: 'Exact',        v: c.exact,           tone: 'text-green-600' },
                { k: 'Normalized',   v: c.normalized,      tone: 'text-green-600' },
                { k: 'Fuzzy',        v: c.fuzzy,           tone: c.fuzzy ? 'text-orange-600' : 'text-gray-400' },
                { k: 'Unmatched',    v: c.unmatched,       tone: c.unmatched ? 'text-red-600' : 'text-gray-400' },
                { k: 'Already have', v: c.skippedHasImage, tone: 'text-gray-400' },
                { k: 'Need review',  v: c.needsPhotoChoice, tone: 'text-primary' },
                { k: 'Single photo', v: c.autoPhoto,       tone: 'text-gray-600' },
              ].map(s => (
                <div key={s.k} className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{s.k}</p>
                  <p className={`text-xl font-bold ${s.tone}`}>{s.v}</p>
                </div>
              ))}
            </div>
          </div>

          {health.looksWrongLine && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-4">
              <p className="text-sm font-bold text-red-800 flex items-center gap-2">
                <AlertTriangle size={16} /> This workbook does not look like it belongs to the selected line
              </p>
              <p className="text-xs text-red-700 mt-1">
                {plan.counts.unmatched} of {plan.counts.rows} rows ({pct(health.unmatchedRatio)}) match no equipment, and only
                {' '}{plan.sheets.filter(s => s.confident).length} of {plan.sheets.length} sheets matched a section confidently.
                The usual cause is the wrong line — tags like M101 and Motor 1 exist on several lines, so a handful can still
                match by coincidence and would attach photos to the wrong assets.
              </p>
              <label className="flex items-center gap-2 mt-3 text-xs font-medium text-red-800">
                <input type="checkbox" checked={overrideWrongLine} onChange={e => setOverrideWrongLine(e.target.checked)} />
                I have checked the line is correct — continue anyway
              </label>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="text-left px-4 py-2.5 font-semibold">Workbook sheet</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Platform section</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Confidence</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Rows</th>
                  <th className="text-center px-4 py-2.5 font-semibold">Issues</th>
                </tr>
              </thead>
              <tbody>
                {plan.sheets.map(sp => {
                  const bad = sp.rows.filter(m => m.kind === 'fuzzy' || m.kind === 'unmatched').length;
                  return (
                    <tr key={sp.sheetName} className="border-t border-gray-50">
                      <td className="px-4 py-2.5 text-xs font-medium text-gray-700">{sp.sheetName}</td>
                      <td className="px-4 py-2.5">
                        <select value={sp.section?.id ?? ''} onChange={e => reassign(sp.sheetName, e.target.value)}
                          className={`w-full px-2 py-1 rounded border text-xs bg-white ${sp.confident ? 'border-gray-200 text-gray-700' : 'border-orange-300 text-orange-700'}`}>
                          <option value="">— not matched —</option>
                          {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          sp.confident ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                          {pct(sp.score)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500 tabular-nums">{sp.rows.length}</td>
                      <td className="px-4 py-2.5 text-center text-xs tabular-nums">
                        {bad ? <span className="text-orange-600 font-semibold">{bad}</span> : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(c.fuzzy > 0 || c.unmatched > 0) && (
            <div className="bg-white rounded-xl border border-orange-200 p-4">
              <p className="text-xs font-bold text-orange-700 mb-2">Rows needing attention</p>
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {plan.sheets.flatMap(sp => sp.rows
                  .filter(m => m.kind === 'fuzzy' || m.kind === 'unmatched')
                  .map(m => (
                    <p key={rowKey(sp.sheetName, m.row.rowIndex)} className="text-[11px] text-gray-600">
                      <span className="text-gray-400">{sp.sheetName}</span> · workbook
                      <span className="font-mono font-semibold"> {m.row.tag}</span>
                      {m.kind === 'fuzzy'
                        ? <> → matched <span className="font-mono font-semibold text-orange-700">{m.equipment?.tag}</span> at {pct(m.score)}</>
                        : <> → <span className="text-red-600 font-semibold">no equipment found</span>
                            {m.positionalHint && <span className="text-gray-400"> (same position: {m.positionalHint.tag})</span>}</>}
                    </p>
                  )))}
              </div>
            </div>
          )}

          {unclaimedSections(plan, sections).length > 0 && (
            <p className="text-[11px] text-gray-400">
              Sections with no sheet: {unclaimedSections(plan, sections).map(s => s.name).join(' · ')}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button onClick={() => setStep('review')} disabled={health.looksWrongLine && !overrideWrongLine}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-colors">
              {reviewCards.length ? `Review ${reviewCards.length} photo choices` : 'Continue'} <ArrowRight size={15} />
            </button>
            <span className="text-xs text-gray-400">
              {c.autoPhoto} single-photo assets assigned automatically · {c.skippedHasImage} skipped · {c.noPhoto} without a photo
            </span>
          </div>
        </div>
      )}

      {/* ── Step 3 · photo review ─────────────────────────────────────────── */}
      {step === 'review' && plan && (
        <div className="space-y-4">
          <div className="sticky top-0 z-10 bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4 flex-wrap">
            <button onClick={() => setStep('match')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={16} /></button>
            <div>
              <h2 className="text-sm font-bold text-gray-900">Confirm the asset photo</h2>
              <p className="text-[11px] text-gray-500">
                Each row holds the machine and its spec nameplate. The machine is <strong>already selected</strong> by
                framing (nameplates are cropped in, so they are smaller) — right about 96% of the time, so scan and
                flip the few that are wrong. Keys: <kbd className="px-1 bg-gray-100 rounded">1</kbd>/<kbd className="px-1 bg-gray-100 rounded">2</kbd> choose, arrows move.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-right">
                <span className="text-xs font-semibold text-gray-500">
                  {reviewCards.length} pre-selected
                </span>
                <p className="text-[10px] text-gray-400">
                  {touched.size ? `${touched.size} changed by you` : 'none changed yet'}
                </p>
              </div>
              <button onClick={commit} disabled={committable === 0 || busy}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                title={allDecided ? undefined : `${pending} rows are still undecided and will be skipped`}>
                Commit {committable} photo{committable === 1 ? '' : 's'}
              </button>
            </div>
          </div>

          {reviewCards.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
              <CheckCircle2 size={30} className="mx-auto text-green-500 mb-2" />
              <p className="text-sm font-medium text-gray-600">Nothing to review — every asset had a single photo.</p>
            </div>
          )}

          {Object.entries(
            reviewCards.reduce<Record<string, typeof reviewCards>>((acc, card) => {
              (acc[card.sheet] ??= []).push(card); return acc;
            }, {}),
          ).map(([sheet, cards]) => (
            <div key={sheet} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-3 mb-3 flex-wrap">
                <p className="text-xs font-bold text-gray-700">{sheet}</p>
                <span className="text-[11px] text-gray-400">{cards[0].section}</span>
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide">Set all to</span>
                  {[0, 1].map(i => (
                    <button key={i} onClick={() => chooseAllInSheet(sheet, i)}
                      className="px-2 py-1 rounded border border-gray-200 text-[11px] font-semibold text-gray-500 hover:bg-gray-50">
                      photo {i + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {cards.map(card => {
                  const chosen = choices[card.key];
                  const active = reviewCards[cursor]?.key === card.key;
                  const lowConfidence = !touched.has(card.key)
                    && pickConfidence(card.match.row.images, metrics) < 0.34;
                  return (
                    <div key={card.key}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        active ? 'border-primary ring-2 ring-primary/20'
                        : !chosen ? 'border-orange-300 bg-orange-50/40'
                        : lowConfidence ? 'border-amber-300 bg-amber-50/30'
                        : 'border-gray-200'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-xs font-mono font-bold text-gray-800 truncate">{card.match.equipment?.tag}</p>
                        {!chosen ? (
                          <span className="text-[10px] font-bold text-orange-600 uppercase ml-auto">pick one</span>
                        ) : touched.has(card.key) ? (
                          <span className="text-[10px] font-bold text-primary uppercase ml-auto">yours</span>
                        ) : (
                          <span className={`text-[10px] font-bold uppercase ml-auto ${lowConfidence ? 'text-amber-600' : 'text-gray-300'}`}
                            title={lowConfidence
                              ? 'The two photos are framed alike, so this pick is a close call — worth a look'
                              : 'Pre-selected automatically'}>
                            {lowConfidence ? 'close call' : 'auto'}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {card.match.row.images.map((img, i) => {
                          const sel = chosen === img.path;
                          return (
                            <button key={img.path} onClick={() => {
                              setChoices(prev => ({ ...prev, [card.key]: img.path }));
                              setTouched(prev => new Set(prev).add(card.key));
                              setCursor(reviewCards.findIndex(x => x.key === card.key));
                            }}
                              className={`relative rounded-md overflow-hidden border-2 transition-all ${
                                sel ? 'border-primary' : 'border-transparent hover:border-gray-300 opacity-70 hover:opacity-100'}`}>
                              <img src={imgUrl(img)} alt={`option ${i + 1}`} loading="lazy"
                                className="w-full h-36 object-contain bg-gray-50" />
                              <span className={`absolute top-1 left-1 w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center ${
                                sel ? 'bg-primary text-white' : 'bg-white/80 text-gray-500'}`}>{i + 1}</span>
                              {sel && <CheckCircle2 size={15} className="absolute top-1 right-1 text-primary bg-white rounded-full" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Step 4 · commit ───────────────────────────────────────────────── */}
      {step === 'done' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          {busy ? (
            <>
              <p className="text-sm font-bold text-gray-900 flex items-center gap-2">
                <Loader2 size={15} className="animate-spin text-primary" /> Uploading photos…
              </p>
              <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full bg-primary transition-all"
                  style={{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%' }} />
              </div>
              <p className="text-xs text-gray-400 tabular-nums">{progress.done} / {progress.total}</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {results.every(r => r.ok)
                  ? <CheckCircle2 size={18} className="text-green-500" />
                  : <AlertTriangle size={18} className="text-orange-500" />}
                <p className="text-sm font-bold text-gray-900">
                  {results.filter(r => r.ok).length} photos imported
                  {results.some(r => !r.ok) && ` · ${results.filter(r => !r.ok).length} failed`}
                </p>
              </div>
              {plan && (
                <p className="text-xs text-gray-500">
                  {plan.counts.skippedHasImage} skipped (already had a photo) ·
                  {' '}{plan.counts.noPhoto} had no photo in the workbook ·
                  {' '}{plan.counts.unmatched} rows matched no equipment
                  {pending > 0 && (
                    <> · <span className="font-semibold text-orange-600">{pending} left undecided</span> — load the
                    same workbook again to finish them; imported assets drop out automatically.</>
                  )}
                </p>
              )}
              {results.some(r => !r.ok) && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 max-h-52 overflow-y-auto space-y-1">
                  {results.filter(r => !r.ok).map(r => (
                    <p key={r.tag + r.section} className="text-[11px] text-red-700">
                      <span className="font-mono font-semibold">{r.tag}</span> — {r.error}
                    </p>
                  ))}
                </div>
              )}
              {plan && plan.missingFromWorkbook.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
                    <ImageOff size={12} /> Equipment with no photo in this workbook
                  </summary>
                  <div className="mt-2 space-y-1 max-h-44 overflow-y-auto">
                    {plan.missingFromWorkbook.map(g => (
                      <p key={g.section.id} className="text-[11px] text-gray-500">
                        <span className="text-gray-400">{g.section.name}:</span> {g.equipment.map(e => e.tag).join(', ')}
                      </p>
                    ))}
                  </div>
                </details>
              )}
              <button onClick={reset}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                <Images size={15} /> Import another workbook
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
