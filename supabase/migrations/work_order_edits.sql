-- ─────────────────────────────────────────────────────────────────────────────
-- Editable work orders + edit attribution
--
-- Everything captured when a work order was raised (title, description,
-- priority, assignee, SAP number, due date, recommendation) was frozen once the
-- record existed. IME admins can now correct it.
--
-- edited_* is kept separate from status_changed_* and cmms_set_*: moving a WO to
-- In Progress is not the same event as rewriting its due date, and collapsing
-- them would make "who changed this?" unanswerable. A status-only or CMMS-only
-- change deliberately does NOT touch edited_*.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.work_orders
  add column if not exists edited_by      uuid references public.profiles(id) on delete set null,
  add column if not exists edited_by_name text,
  add column if not exists edited_at      timestamptz;

create or replace function public.stamp_wo_actor()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  nm  text;
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

  -- The detail fields an IME admin can correct after the fact.
  if new.title          is distinct from old.title
  or new.description    is distinct from old.description
  or new.priority       is distinct from old.priority
  or new.assignee       is distinct from old.assignee
  or new.sap_no         is distinct from old.sap_no
  or new.due_date       is distinct from old.due_date
  or new.recommendation is distinct from old.recommendation
  then
    new.edited_by      := uid;
    new.edited_by_name := nm;
    new.edited_at      := now();
  end if;

  return new;
end $$;
