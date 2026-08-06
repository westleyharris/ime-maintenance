-- ─────────────────────────────────────────────────────────────────────────────
-- Work order recommendation snapshot (APPLIED 2026-08-06)
--
-- The work-order detail popup shows the analyst's recommendation instead of the
-- auto-generated description. The recommendation lives on the finding, but
-- reconcile_findings() DELETES a finding once its asset recovers and
-- work_orders.finding_id is ON DELETE SET NULL — so reading it live would make
-- the recommendation vanish from older work orders.
--
-- Snapshot it onto the work order at creation instead (same pattern as
-- finding_notified_at), and backfill the ones still linked.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders add column if not exists recommendation text;

update public.work_orders w
set recommendation = f.recommendation
from public.findings f
where f.id = w.finding_id
  and w.recommendation is null
  and nullif(btrim(f.recommendation), '') is not null;
