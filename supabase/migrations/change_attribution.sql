-- ─────────────────────────────────────────────────────────────────────────────
-- Change attribution — who did it, not just what happened
--
-- Actors are stamped by TRIGGERS from auth.uid(), never sent by the client. An
-- audit trail the browser can fill in is not an audit trail: anyone could post
-- someone else's id. The trigger reads the JWT, so the value cannot be forged.
--
-- Each actor is stored twice, as id AND display name. The name is not
-- redundant: profiles RLS only lets an ime_admin read other users' rows, so
-- without the snapshot a plant manager would see a bare UUID. It also freezes
-- who acted at the time, surviving a later rename or departure. Same pattern as
-- measurements.overridden_by / overridden_by_name.
--
-- Rows written by the service role or by SQL (the demo seed, the UAS sync) have
-- no auth.uid() and are deliberately left unattributed rather than mislabelled.
-- ─────────────────────────────────────────────────────────────────────────────

-- SECURITY DEFINER so the lookup can see a profile the caller could not read.
create or replace function public.actor_display_name(p_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(nullif(btrim(p.full_name), ''), p.email)
  from profiles p where p.id = p_id;
$$;

-- ── 1. Activity log: replacement, status change, recommendation ──────────────
alter table public.equipment_notes
  add column if not exists actor_id   uuid references public.profiles(id) on delete set null,
  add column if not exists actor_name text;

create or replace function public.stamp_note_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.actor_id   := auth.uid();
    new.actor_name := public.actor_display_name(auth.uid());
  else
    -- A display name must never survive without a verified id behind it, or a
    -- service-role caller could write an arbitrary name that the UI renders as
    -- though it had been authenticated.
    new.actor_id   := null;
    new.actor_name := null;
  end if;
  return new;
end $$;

drop trigger if exists equipment_notes_stamp_actor on public.equipment_notes;
create trigger equipment_notes_stamp_actor
  before insert on public.equipment_notes
  for each row execute function public.stamp_note_actor();

-- ── 2. Findings: who wrote the recommendation, who sent the notification ─────
alter table public.findings
  add column if not exists recommendation_by      uuid references public.profiles(id) on delete set null,
  add column if not exists recommendation_by_name text,
  add column if not exists recommendation_at      timestamptz,
  add column if not exists notified_by            uuid references public.profiles(id) on delete set null,
  add column if not exists notified_by_name       text;

-- Only a non-empty recommendation counts as authorship — clearing the field
-- should not record someone as its author.
create or replace function public.stamp_finding_actor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and new.recommendation is distinct from old.recommendation
     and nullif(btrim(coalesce(new.recommendation, '')), '') is not null
  then
    new.recommendation_by      := auth.uid();
    new.recommendation_by_name := public.actor_display_name(auth.uid());
    new.recommendation_at      := now();
  end if;
  return new;
end $$;

drop trigger if exists findings_stamp_actor on public.findings;
create trigger findings_stamp_actor
  before update on public.findings
  for each row execute function public.stamp_finding_actor();

-- ── 3. Work orders: status changes, closure, CMMS number ─────────────────────
-- closed_* is kept separate from status_changed_* so that reopening a work
-- order does not erase who signed off on the original closure.
alter table public.work_orders
  add column if not exists status_changed_by      uuid references public.profiles(id) on delete set null,
  add column if not exists status_changed_by_name text,
  add column if not exists status_changed_at      timestamptz,
  add column if not exists closed_by              uuid references public.profiles(id) on delete set null,
  add column if not exists closed_by_name         text,
  add column if not exists closed_at              timestamptz,
  add column if not exists cmms_set_by            uuid references public.profiles(id) on delete set null,
  add column if not exists cmms_set_by_name       text,
  add column if not exists cmms_set_at            timestamptz,
  -- created_by already existed but held only an id, which no non-admin could
  -- resolve to a name; the snapshot makes the existing data displayable.
  add column if not exists created_by_name        text;

create or replace function public.stamp_wo_actor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  nm   text;
begin
  if uid is null then return new; end if;
  nm := public.actor_display_name(uid);

  if tg_op = 'INSERT' then
    new.created_by      := coalesce(new.created_by, uid);
    new.created_by_name := coalesce(new.created_by_name, public.actor_display_name(new.created_by));
    return new;
  end if;

  if new.status is distinct from old.status then
    new.status_changed_by      := uid;
    new.status_changed_by_name := nm;
    new.status_changed_at      := now();
    if new.status = 'closed' then
      new.closed_by      := uid;
      new.closed_by_name := nm;
      new.closed_at      := now();
    end if;
  end if;

  if new.cmms_wo_no is distinct from old.cmms_wo_no then
    new.cmms_set_by      := uid;
    new.cmms_set_by_name := nm;
    new.cmms_set_at      := now();
  end if;

  return new;
end $$;

drop trigger if exists work_orders_stamp_actor on public.work_orders;
create trigger work_orders_stamp_actor
  before insert or update on public.work_orders
  for each row execute function public.stamp_wo_actor();

-- Backfill names for work orders that already recorded a creator id.
update public.work_orders
set created_by_name = public.actor_display_name(created_by)
where created_by is not null and created_by_name is null;
