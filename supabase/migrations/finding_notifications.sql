-- ─────────────────────────────────────────────────────────────────────────────
-- Findings email notifications + Notification→WO KPI (APPLIED 2026-07-02)
--
-- The analyst selects findings in the Findings tab and notifies people by
-- email (ime_admins, the company's company_admins, the plant's plant_managers)
-- via the notify-findings edge function.
--
-- findings.notified_at            — stamped on the FIRST notification only, so
--                                   the KPI measures time from first notice.
-- work_orders.finding_notified_at — copied from the finding when the WO is
--                                   created; the KPI (mean time notification →
--                                   work order) is computed from work_orders
--                                   so it survives reconcile_findings()
--                                   deleting recovered findings.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.findings add column if not exists notified_at timestamptz;
alter table public.work_orders add column if not exists finding_notified_at timestamptz;
