-- ─────────────────────────────────────────────────────────────────────────────
-- UAS display order (APPLIED 2026-08-05)
--
-- UAS3 stores each node's sibling display order in tbl_mast_nodes.node_order.
-- That ordering is meaningful — it follows the physical process flow
-- (Depalletizer to Airveyor -> Airveyor to Filler -> Filler to Warmer -> ...),
-- not the alphabet. The sync already SELECTed node_order but never stored it, so
-- the platform's asset tree rendered children in arbitrary insertion order and
-- didn't match what analysts see in UAS3.
--
-- sync-uas3.ps1 now writes node_order into uas_order at every level, and the
-- Assets tree sorts by it (falling back to name when it's absent).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lines              add column if not exists uas_order integer;
alter table public.sections           add column if not exists uas_order integer;
alter table public.equipment          add column if not exists uas_order integer;
alter table public.components         add column if not exists uas_order integer;
alter table public.measurement_points add column if not exists uas_order integer;

-- ordering is always resolved within a parent, so index by (parent, order)
create index if not exists lines_order_idx      on public.lines (location_id, uas_order);
create index if not exists sections_order_idx   on public.sections (line_id, uas_order);
create index if not exists equipment_order_idx  on public.equipment (section_id, uas_order);
create index if not exists components_order_idx on public.components (equipment_id, uas_order);
create index if not exists mp_order_idx         on public.measurement_points (component_id, uas_order);
