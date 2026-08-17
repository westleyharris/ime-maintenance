// ── Effective alarm level ─────────────────────────────────────────────────────
//
// measurements.alarm_level is a GENERATED column derived from crest factor, so
// it can never be written to. A transient CF spike (impulsive noise during
// capture, a bumped sensor) can push a healthy point straight to Danger, so an
// analyst can reclassify the READING via measurements.alarm_override.
//
// The computed level is never destroyed — every consumer resolves the pair with
// effectiveAlarm(). Mirrors coalesce(alarm_override, alarm_level) server-side in
// reconcile_findings().

/** Columns a query must select for effectiveAlarm()/overrideOf() to work. */
export const ALARM_COLUMNS =
  'alarm_level, alarm_override, override_reason, overridden_by_name, overridden_at';

export interface AlarmSource {
  alarm_level: string | null;
  alarm_override?: string | null;
  override_reason?: string | null;
  overridden_by_name?: string | null;
  overridden_at?: string | null;
}

export interface AlarmOverride {
  level: string;
  computed: string;
  reason: string | null;
  by: string | null;
  at: string | null;
}

/** The level the whole app should display, count and alarm on. */
export function effectiveAlarm(m: AlarmSource): string {
  return m.alarm_override ?? m.alarm_level ?? 'Normal';
}

/** Override detail for the audit line, or null when the reading is untouched. */
export function overrideOf(m: AlarmSource): AlarmOverride | null {
  if (!m.alarm_override) return null;
  return {
    level:    m.alarm_override,
    computed: m.alarm_level ?? 'Normal',
    reason:   m.override_reason ?? null,
    by:       m.overridden_by_name ?? null,
    at:       m.overridden_at ?? null,
  };
}

/**
 * Collapse fetched rows onto their effective level so every downstream reader
 * — counts, badges, worst-of rollups — sees a single field. The computed level
 * is not lost: it is preserved on the attached `override` object.
 */
export function withEffectiveAlarm<T extends AlarmSource>(
  rows: T[],
): (T & { alarm_level: string; override: AlarmOverride | null })[] {
  return rows.map(m => ({ ...m, alarm_level: effectiveAlarm(m), override: overrideOf(m) }));
}

/** One-line provenance, e.g. for a badge tooltip. */
export function overrideSummary(o: AlarmOverride): string {
  const who  = o.by ? ` by ${o.by}` : '';
  const when = o.at ? ` on ${new Date(o.at).toLocaleDateString('en-US', { dateStyle: 'medium' })}` : '';
  return `Computed ${o.computed} — reclassified to ${o.level}${who}${when}${o.reason ? `\n"${o.reason}"` : ''}`;
}

export const ALARM_LEVELS = ['Normal', 'Alert', 'Warning', 'Danger'] as const;
