// ── Matching mapping-workbook rows to equipment ───────────────────────────────
//
// Order matters: line → section → tag. A tag is only unique once the section is
// known — "Motor 1".."Motor 9" exist in TWO sections of Alsip L1, and M101 exists
// on both L1 and L3. The line is chosen by the analyst; this module resolves the
// section, then the tag within it.
//
// Sections are matched by RARITY-WEIGHTED TAG OVERLAP rather than by name. Sheet
// names and section names routinely disagree ("OC Left Diverter to Spiral 11" vs
// "Overhead Left/Under CV Diverter to Spiral 11") but their tag sets barely do.
// Weighting by inverse frequency lets a distinctive TBG1.2125+TBG-MTR101 decide
// the match while a generic "Motor 5" — which sits in two sections — contributes
// almost nothing.

import type { WorkbookRow, WorkbookSheet } from './mappingWorkbook';

export interface DbEquipment {
  id: string;
  tag: string;
  imageUrl: string | null;
  uasOrder: number | null;
}

export interface DbSection {
  id: string;
  name: string;
  equipment: DbEquipment[];
}

export type TagMatchKind = 'exact' | 'normalized' | 'fuzzy' | 'unmatched';

export interface RowMatch {
  row: WorkbookRow;
  equipment: DbEquipment | null;
  kind: TagMatchKind;
  /** Similarity that produced a fuzzy match; 1 for exact/normalized. */
  score: number;
  /** Equipment at the same ordinal. Displayed as a hint — never auto-bound. */
  positionalHint: DbEquipment | null;
  /** Matched, but the asset already has a photo, so it will be left alone. */
  skippedHasImage: boolean;
}

export interface SheetPlan {
  sheetName: string;
  section: DbSection | null;
  score: number;
  runnerUpScore: number;
  confident: boolean;
  rows: RowMatch[];
}

export interface MatchPlan {
  sheets: SheetPlan[];
  /** Equipment the workbook never mentioned, i.e. no photo available. */
  missingFromWorkbook: { section: DbSection; equipment: DbEquipment[] }[];
  counts: {
    rows: number;
    exact: number;
    normalized: number;
    fuzzy: number;
    unmatched: number;
    skippedHasImage: number;
    /** Assignable rows offering more than one photo — these need a human. */
    needsPhotoChoice: number;
    /** Assignable rows with exactly one photo — nothing to decide. */
    autoPhoto: number;
    noPhoto: number;
  };
}

// ── string helpers ────────────────────────────────────────────────────────────

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const digitRuns = (s: string) => (s.match(/\d+/g) ?? []).join('.');

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 0..1 similarity, or 0 when the two differ in their NUMBERS.
 *
 * That guard is the important part: "Motor 1"/"Motor 10" and "M101"/"M102" are
 * one edit apart and would otherwise fuzzy-match, which is precisely how a photo
 * lands on the wrong asset. Tags that differ numerically are different assets.
 */
export function similarity(a: string, b: string): number {
  if (digitRuns(a) !== digitRuns(b)) return 0;
  const ta = tokens(a), tb = tokens(b);
  const sa = new Set(ta), sb = new Set(tb);
  const subset = ta.every(t => sb.has(t)) || tb.every(t => sa.has(t));
  const tokenScore = subset && sa.size && sb.size
    ? Math.min(sa.size, sb.size) / Math.max(sa.size, sb.size)
    : 0;
  const na = normalize(a), nb = normalize(b);
  const lev = na.length && nb.length
    ? 1 - levenshtein(na, nb) / Math.max(na.length, nb.length)
    : 0;
  return Math.max(tokenScore, lev);
}

const FUZZY_THRESHOLD = 0.6;
// Below this a sheet→section match is not trusted without the analyst confirming.
// Set well above the ~60% a wrong-line workbook can reach on shared tags (L1 and
// L3 both carry M101-M108), but comfortably under the 90-100% a correct one scores.
const SECTION_CONFIDENT = 0.75;
const SECTION_MARGIN = 0.15;

// ── section matching ──────────────────────────────────────────────────────────

interface Scored { sheet: number; section: number; score: number }

function scoreSections(sheets: WorkbookSheet[], sections: DbSection[]): number[][] {
  // How many sections hold each tag, so shared tags count for less.
  const freq = new Map<string, number>();
  for (const sec of sections) {
    for (const t of new Set(sec.equipment.map(e => normalize(e.tag)))) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  const weight = (t: string) => 1 / (freq.get(t) ?? 1);

  return sheets.map(sh => {
    const sheetTags = [...new Set(sh.rows.map(r => normalize(r.tag)))];
    const total = sheetTags.reduce((s, t) => s + weight(t), 0);
    return sections.map(sec => {
      if (!total) return 0;
      const secTags = new Set(sec.equipment.map(e => normalize(e.tag)));
      const hit = sheetTags.filter(t => secTags.has(t)).reduce((s, t) => s + weight(t), 0);
      return hit / total;
    });
  });
}

/**
 * Greedy one-to-one assignment, best score first, so two sheets can never claim
 * the same section.
 */
export function matchSections(
  sheets: WorkbookSheet[],
  sections: DbSection[],
): { sectionIndex: number | null; score: number; runnerUp: number }[] {
  const grid = scoreSections(sheets, sections);
  const all: Scored[] = [];
  grid.forEach((row, i) => row.forEach((score, j) => { if (score > 0) all.push({ sheet: i, section: j, score }); }));
  all.sort((a, b) => b.score - a.score);

  const bySheet: (number | null)[] = sheets.map(() => null);
  const takenSection = new Set<number>();
  const takenSheet = new Set<number>();
  for (const { sheet, section, score } of all) {
    if (takenSheet.has(sheet) || takenSection.has(section) || score <= 0) continue;
    bySheet[sheet] = section;
    takenSheet.add(sheet);
    takenSection.add(section);
  }

  return sheets.map((_, i) => {
    const chosen = bySheet[i];
    const scores = [...grid[i]].sort((a, b) => b - a);
    return {
      sectionIndex: chosen,
      score: chosen == null ? 0 : grid[i][chosen],
      runnerUp: scores[1] ?? 0,
    };
  });
}

// ── tag matching within a resolved section ────────────────────────────────────

export function matchRows(rows: WorkbookRow[], section: DbSection | null): RowMatch[] {
  const base = (row: WorkbookRow, i: number): RowMatch => ({
    row,
    equipment: null,
    kind: 'unmatched',
    score: 0,
    positionalHint: section?.equipment[i] ?? null,
    skippedHasImage: false,
  });
  if (!section) return rows.map(base);

  const claimed = new Set<string>();
  const out = rows.map(base);
  const free = () => section.equipment.filter(e => !claimed.has(e.id));

  const pass = (
    kind: Exclude<TagMatchKind, 'unmatched'>,
    pick: (tag: string, pool: DbEquipment[]) => { eq: DbEquipment; score: number } | null,
  ) => {
    out.forEach((m, i) => {
      if (m.equipment) return;
      const hit = pick(rows[i].tag, free());
      if (!hit) return;
      m.equipment = hit.eq;
      m.kind = kind;
      m.score = hit.score;
      claimed.add(hit.eq.id);
    });
  };

  pass('exact', (tag, pool) => {
    const eq = pool.find(e => e.tag === tag);
    return eq ? { eq, score: 1 } : null;
  });
  pass('normalized', (tag, pool) => {
    const n = normalize(tag);
    const eq = pool.find(e => normalize(e.tag) === n);
    return eq ? { eq, score: 1 } : null;
  });
  pass('fuzzy', (tag, pool) => {
    let best: { eq: DbEquipment; score: number } | null = null;
    for (const eq of pool) {
      const score = similarity(tag, eq.tag);
      if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { eq, score };
    }
    return best;
  });

  for (const m of out) {
    if (m.equipment?.imageUrl) m.skippedHasImage = true;
  }
  return out;
}

// ── whole-workbook plan ───────────────────────────────────────────────────────

/**
 * @param overrides sheet name → section id, from the analyst correcting the
 *   summary table. An override is taken as given: it is marked confident and its
 *   rows are re-matched against the section the analyst chose.
 */
export function buildMatchPlan(
  sheets: WorkbookSheet[],
  sections: DbSection[],
  overrides: Record<string, string> = {},
): MatchPlan {
  const secMatches = matchSections(sheets, sections);

  const plans: SheetPlan[] = sheets.map((sh, i) => {
    const { sectionIndex, score, runnerUp } = secMatches[i];
    const override = Object.prototype.hasOwnProperty.call(overrides, sh.name);
    const section = override
      ? (sections.find(s => s.id === overrides[sh.name]) ?? null)
      : (sectionIndex == null ? null : sections[sectionIndex]);
    return {
      sheetName: sh.name,
      section,
      score,
      runnerUpScore: runnerUp,
      confident: override
        ? section != null
        : section != null && score >= SECTION_CONFIDENT && score - runnerUp >= SECTION_MARGIN,
      rows: matchRows(sh.rows, section),
    };
  });

  const counts = {
    rows: 0, exact: 0, normalized: 0, fuzzy: 0, unmatched: 0,
    skippedHasImage: 0, needsPhotoChoice: 0, autoPhoto: 0, noPhoto: 0,
  };
  for (const p of plans) {
    for (const m of p.rows) {
      counts.rows++;
      counts[m.kind]++;
      if (m.skippedHasImage) { counts.skippedHasImage++; continue; }
      if (!m.equipment) continue;
      const n = m.row.images.length;
      if (n === 0) counts.noPhoto++;
      else if (n === 1) counts.autoPhoto++;
      else counts.needsPhotoChoice++;
    }
  }

  const usedSectionIds = new Set(plans.map(p => p.section?.id).filter(Boolean) as string[]);
  const matchedEquipIds = new Set(
    plans.flatMap(p => p.rows.map(m => m.equipment?.id).filter(Boolean) as string[]),
  );
  const missingFromWorkbook = sections
    .filter(s => usedSectionIds.has(s.id))
    .map(section => ({ section, equipment: section.equipment.filter(e => !matchedEquipIds.has(e.id)) }))
    .filter(x => x.equipment.length > 0);

  return { sheets: plans, missingFromWorkbook, counts };
}

/**
 * Does this workbook plausibly belong to the selected line?
 *
 * Picking the wrong line is the one mistake that silently puts photos on the
 * wrong assets, and shared tags mean a stray sheet can still match. Judge the
 * workbook as a whole rather than sheet by sheet.
 */
export function planHealth(plan: MatchPlan) {
  const unmatchedRatio = plan.counts.rows ? plan.counts.unmatched / plan.counts.rows : 1;
  const confidentRatio = plan.sheets.length
    ? plan.sheets.filter(s => s.confident).length / plan.sheets.length : 0;
  return {
    unmatchedRatio,
    confidentRatio,
    looksWrongLine: unmatchedRatio > 0.2 || confidentRatio < 0.7,
  };
}

/** Sections not claimed by any sheet — surfaced so a whole missing sheet is obvious. */
export function unclaimedSections(plan: MatchPlan, sections: DbSection[]): DbSection[] {
  const used = new Set(plan.sheets.map(p => p.section?.id).filter(Boolean) as string[]);
  return sections.filter(s => !used.has(s.id));
}
