-- ─────────────────────────────────────────────────────────────────────────────
-- Work order close note (APPLIED 2026-07-02)
--
-- When a user closes a work order the app requires a closing note: a preset
-- reason picked from a dropdown ("Nothing was found", "Was sent to repair", …)
-- plus optional free-text detail. Stored on the work order itself.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders add column if not exists close_note text;
