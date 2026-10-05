-- ─────────────────────────────────────────────────────────────────────────────
-- Remove Asset Health timeline events
--
-- Soft delete, not a hard one. The brief was "remove the event AND log who
-- removed it" — and a deleted row cannot record its own deletion. Marking it
-- removed satisfies both: it disappears from every view, the audit lives on the
-- row itself, and a mistaken removal is recoverable.
--
-- Only equipment_notes are removable. Measurements are deliberately excluded:
-- the UAS3 sync upserts them on (measurement_point_id, measured_at) every run,
-- so a deleted reading reappears on the next sync. A wrong alarm is handled by
-- measurements.alarm_override instead, which the sync does not overwrite.
--
-- The write goes through a SECURITY DEFINER function rather than a broad UPDATE
-- policy, so the ime_admin check and the actor stamp cannot be bypassed by a
-- direct PostgREST call.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.equipment_notes
  add column if not exists deleted_at      timestamptz,
  add column if not exists deleted_by      uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_by_name text;

-- Every read filters on deleted_at is null, so keep that path cheap.
create index if not exists equipment_notes_live_idx
  on public.equipment_notes (equipment_id, created_at desc)
  where deleted_at is null;

create or replace function public.delete_equipment_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '');
  v_note public.equipment_notes;
  v_prev timestamptz;
begin
  if v_role <> 'ime_admin' then
    raise exception 'only an IME analyst (ime_admin) may remove timeline events';
  end if;

  select * into v_note from equipment_notes
  where id = p_note_id and deleted_at is null;
  if not found then
    raise exception 'event not found, or it has already been removed';
  end if;

  update equipment_notes set
    deleted_at      = now(),
    deleted_by      = auth.uid(),
    deleted_by_name = public.actor_display_name(auth.uid())
  where id = p_note_id;

  -- Removing a replacement has to undo the replacement boundary too. Otherwise
  -- equipment.last_replaced_at keeps archiving earlier measurements while the
  -- event explaining why is gone from the timeline.
  if v_note.note_type = 'replacement' then
    select max(coalesce((metadata ->> 'replaced_at')::timestamptz, created_at))
      into v_prev
    from equipment_notes
    where equipment_id = v_note.equipment_id
      and note_type = 'replacement'
      and deleted_at is null;

    update equipment set last_replaced_at = v_prev where id = v_note.equipment_id;
  end if;
end $$;

grant execute on function public.delete_equipment_note(uuid) to authenticated;

-- Restore path for a mistaken removal. Not surfaced in the UI; it exists so a
-- removal is never actually unrecoverable.
create or replace function public.restore_equipment_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '');
  v_note public.equipment_notes;
begin
  if v_role <> 'ime_admin' then
    raise exception 'only an IME analyst (ime_admin) may restore timeline events';
  end if;

  select * into v_note from equipment_notes where id = p_note_id and deleted_at is not null;
  if not found then raise exception 'event not found, or it is not removed'; end if;

  update equipment_notes
  set deleted_at = null, deleted_by = null, deleted_by_name = null
  where id = p_note_id;

  if v_note.note_type = 'replacement' then
    update equipment e
    set last_replaced_at = greatest(
          coalesce(e.last_replaced_at, '-infinity'::timestamptz),
          coalesce((v_note.metadata ->> 'replaced_at')::timestamptz, v_note.created_at))
    where e.id = v_note.equipment_id;
  end if;
end $$;

grant execute on function public.restore_equipment_note(uuid) to authenticated;
