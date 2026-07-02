-- ─────────────────────────────────────────────────────────────────────────────
-- Work order CMMS number + one-active-WO-per-asset + recommendation timeline
-- (APPLIED 2026-07-02)
--
-- 1. work_orders.cmms_wo_no — manually filled by users after the WO is
--    created in the plant's CMMS system.
-- 2. An asset can only have ONE active (open/in_progress) work order; the old
--    one must be closed/cancelled before a new one can be created. Enforced
--    with a BEFORE INSERT trigger rather than a unique index so pre-existing
--    rows are left untouched.
-- 3. equipment_notes.note_type gains 'recommendation' — when the analyst
--    fills a recommendation on a finding, the app writes a recommendation
--    note so it shows as an event in the asset health timeline (and survives
--    the finding later recovering/being deleted by reconcile_findings()).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders add column if not exists cmms_wo_no text;

create or replace function public.enforce_single_active_wo()
returns trigger
language plpgsql
as $$
begin
  if new.equipment_id is not null and exists (
    select 1 from public.work_orders
    where equipment_id = new.equipment_id
      and status in ('open', 'in_progress')
  ) then
    raise exception 'Asset already has an active work order — close it before creating a new one'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists work_orders_single_active on public.work_orders;
create trigger work_orders_single_active
  before insert on public.work_orders
  for each row execute function public.enforce_single_active_wo();

alter table public.equipment_notes drop constraint equipment_notes_note_type_check;
alter table public.equipment_notes add constraint equipment_notes_note_type_check
  check (note_type in ('general', 'status_change', 'replacement', 'recommendation'));
