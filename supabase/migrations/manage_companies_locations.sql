-- ─────────────────────────────────────────────────────────────────────────────
-- Admin management of companies and plants
--
-- Editing goes through normal PostgREST updates (ime_admin already has full
-- access). Deletion does NOT: it is permitted only when nothing of substance
-- hangs off the record, and that rule is enforced here rather than in the
-- browser, so a stray API call cannot destroy survey history.
--
-- Why a whitelist of blockers rather than "just try the delete":
--   · companies cascade to locations/lines/sections/equipment/.../measurements,
--     so an unguarded delete silently destroys years of readings
--   · findings, work_orders and feedback hold PLAIN references to company_id,
--     and nine tables hold plain references to location_id, so an unguarded
--     delete usually fails with an opaque FK error instead
-- Counting first turns both failure modes into a clear, actionable message.
--
-- profiles.company_id is ON DELETE SET NULL, so removing a company detaches its
-- users rather than blocking. profiles.location_id is a plain FK, so a plant
-- manager pinned to a plant DOES block that plant's deletion — surfaced as a
-- blocker instead of a constraint violation.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.company_delete_blockers(p_company_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'equipment',    (select count(*) from equipment    where company_id = p_company_id),
    'measurements', (select count(*) from measurements where company_id = p_company_id),
    'findings',     (select count(*) from findings     where company_id = p_company_id),
    'work_orders',  (select count(*) from work_orders  where company_id = p_company_id),
    'feedback',     (select count(*) from feedback     where company_id = p_company_id)
  );
$$;

create or replace function public.location_delete_blockers(p_location_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'equipment',    (select count(*) from equipment          where location_id = p_location_id),
    'measurements', (select count(*) from measurements       where location_id = p_location_id),
    'points',       (select count(*) from measurement_points where location_id = p_location_id),
    'components',   (select count(*) from components         where location_id = p_location_id),
    'sections',     (select count(*) from sections           where location_id = p_location_id),
    'findings',     (select count(*) from findings           where location_id = p_location_id),
    'work_orders',  (select count(*) from work_orders        where location_id = p_location_id),
    'feedback',     (select count(*) from feedback           where location_id = p_location_id),
    'users',        (select count(*) from profiles           where location_id = p_location_id)
  );
$$;

grant execute on function public.company_delete_blockers(uuid)  to authenticated;
grant execute on function public.location_delete_blockers(uuid) to authenticated;

/** Human-readable "3 equipment, 42 measurements" from a blockers object. */
create or replace function public.describe_blockers(p_blockers jsonb)
returns text language sql immutable as $$
  select string_agg(value || ' ' || key, ', ' order by key)
  from jsonb_each_text(p_blockers) where value <> '0';
$$;

create or replace function public.delete_company(p_company_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role     text := coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '');
  v_blockers jsonb;
  v_name     text;
begin
  if v_role <> 'ime_admin' then
    raise exception 'only an IME analyst (ime_admin) may delete a company';
  end if;

  select name into v_name from companies where id = p_company_id;
  if v_name is null then raise exception 'company not found'; end if;

  v_blockers := public.company_delete_blockers(p_company_id);
  if public.describe_blockers(v_blockers) is not null then
    raise exception '% still holds %. Remove them first, or keep the company.',
      v_name, public.describe_blockers(v_blockers);
  end if;

  -- Safe now: only locations/lines/sections remain, and all three cascade.
  delete from companies where id = p_company_id;
end $$;

create or replace function public.delete_location(p_location_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role     text := coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '');
  v_blockers jsonb;
  v_name     text;
begin
  if v_role <> 'ime_admin' then
    raise exception 'only an IME analyst (ime_admin) may delete a plant';
  end if;

  select name into v_name from locations where id = p_location_id;
  if v_name is null then raise exception 'plant not found'; end if;

  v_blockers := public.location_delete_blockers(p_location_id);
  if public.describe_blockers(v_blockers) is not null then
    raise exception '% still holds %. Remove them first, or keep the plant.',
      v_name, public.describe_blockers(v_blockers);
  end if;

  -- Only lines may remain, and lines.location_id cascades.
  delete from locations where id = p_location_id;
end $$;

grant execute on function public.delete_company(uuid)  to authenticated;
grant execute on function public.delete_location(uuid) to authenticated;
