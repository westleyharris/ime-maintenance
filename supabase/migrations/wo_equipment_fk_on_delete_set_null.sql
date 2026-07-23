-- ─────────────────────────────────────────────────────────────────────────────
-- work_orders.equipment_id → ON DELETE SET NULL (APPLIED 2026-07-22)
--
-- The UAS3 sync's mark-and-sweep hard-deletes a location's stale hierarchy rows
-- (measurements → points → components → equipment → sections → lines). The
-- work_orders.equipment_id FK was NO ACTION, so sweeping any equipment that had
-- a work order (Fort Worth had 3) raised a foreign-key violation → PostgREST
-- returned 409 Conflict → the entire sync aborted before uploading signals.
--
-- SET NULL (matching work_orders.finding_id) lets the sweep delete the asset;
-- the work order is preserved with its history, just detached from the removed
-- equipment. Every other FK into the swept tables was already CASCADE.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders drop constraint work_orders_equipment_id_fkey;
alter table public.work_orders
  add constraint work_orders_equipment_id_fkey
  foreign key (equipment_id) references public.equipment(id) on delete set null;
