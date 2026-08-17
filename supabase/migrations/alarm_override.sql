-- ─────────────────────────────────────────────────────────────────────────────
-- Analyst alarm override
--
-- crest_factor and alarm_level are GENERATED ALWAYS columns — they cannot be
-- written to. A transient spike (impulsive noise during capture, a bumped
-- sensor) pushes crest factor past the Danger cutoff and raises a finding for a
-- point that is actually healthy.
--
-- So the analyst overrides the READING, not the rule: the computed alarm_level
-- stays intact and visible, and an override sits beside it. Everything that
-- consumes a condition reads coalesce(alarm_override, alarm_level).
--
-- The override is scoped to one measurement, so it expires on its own — the
-- next survey produces a new reading that is evaluated fresh. It can never
-- permanently mute a point.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.measurements
  add column if not exists alarm_override  text
    check (alarm_override in ('Normal','Alert','Warning','Danger')),
  add column if not exists override_reason text,
  add column if not exists overridden_by   uuid references public.profiles(id) on delete set null,
  -- Denormalised on purpose: profiles RLS only lets ime_admin read other users'
  -- rows, so a plant manager could never resolve overridden_by to a name. It is
  -- also the better audit record — who signed off at the time, not who that id
  -- belongs to today.
  add column if not exists overridden_by_name text,
  add column if not exists overridden_at   timestamptz;

comment on column public.measurements.alarm_override is
  'Analyst reclassification of this reading. NULL = use the computed alarm_level. Effective condition is always coalesce(alarm_override, alarm_level).';

-- Overridden readings are rare; a partial index keeps the "show me every
-- override" audit query cheap without carrying the 12k Normal rows.
create index if not exists measurements_alarm_override_idx
  on public.measurements(alarm_override) where alarm_override is not null;

-- ── Guard — only ime_admin may touch the override columns ────────────────────
-- measurements already carries a permissive "company members access" ALL policy,
-- so RLS alone would let a company_admin PATCH alarm_override straight through
-- PostgREST. Column-level enforcement has to be a trigger.
create or replace function public.guard_alarm_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims jsonb := auth.jwt();
begin
  if new.alarm_override      is distinct from old.alarm_override
  or new.override_reason     is distinct from old.override_reason
  or new.overridden_by       is distinct from old.overridden_by
  or new.overridden_by_name  is distinct from old.overridden_by_name
  or new.overridden_at       is distinct from old.overridden_at
  then
    -- No JWT = direct connection (psql, the sync script's service key path).
    if claims is not null and claims <> '{}'::jsonb
       and coalesce((claims -> 'app_metadata') ->> 'role', '') <> 'ime_admin'
       and coalesce(claims ->> 'role', '') <> 'service_role'
    then
      raise exception 'only an IME analyst (ime_admin) may change an alarm override';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists measurements_guard_alarm_override on public.measurements;
create trigger measurements_guard_alarm_override
  before update on public.measurements
  for each row execute function public.guard_alarm_override();

-- ── Write path ───────────────────────────────────────────────────────────────
-- p_level NULL clears the override and restores the computed level.
create or replace function public.set_alarm_override(
  p_measurement_id uuid,
  p_level          text,
  p_reason         text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce((auth.jwt() -> 'app_metadata') ->> 'role', '');
  v_name text;
begin
  if v_role <> 'ime_admin' then
    raise exception 'only an IME analyst (ime_admin) may override an alarm level';
  end if;

  if p_level is not null and p_level not in ('Normal','Alert','Warning','Danger') then
    raise exception 'invalid alarm level: %', p_level;
  end if;

  -- A silent reclassification is worthless in an audit; the reason is the record.
  if p_level is not null and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required when overriding an alarm level';
  end if;

  -- SECURITY DEFINER, so this reads past the profiles RLS that would otherwise
  -- hide the analyst's own row from this lookup.
  select coalesce(nullif(btrim(p.full_name), ''), p.email)
    into v_name from profiles p where p.id = auth.uid();

  update measurements set
    alarm_override     = p_level,
    override_reason    = case when p_level is null then null else btrim(p_reason) end,
    overridden_by      = case when p_level is null then null else auth.uid() end,
    overridden_by_name = case when p_level is null then null else v_name end,
    overridden_at      = case when p_level is null then null else now() end
  where id = p_measurement_id;

  if not found then
    raise exception 'measurement not found: %', p_measurement_id;
  end if;

  -- The finding list derives from the latest reading, so it has to re-derive now.
  perform reconcile_findings();
end $$;

grant execute on function public.set_alarm_override(uuid, text, text) to authenticated;

-- ── Findings now derive from the effective condition ─────────────────────────
--
-- WARNING: findings are per-EQUIPMENT, not per measurement point. The copy of
-- reconcile_findings() in findings_work_orders.sql is STALE — migration
-- findings_by_equipment (20260711141225) was applied straight to the project and
-- never written back to this directory. Treat the live DB as source of truth for
-- this function; rebuilding it from findings_work_orders.sql inserts findings
-- without equipment_id and violates its NOT NULL.
--
-- Below is that live per-equipment definition, with the only change being that
-- every condition read is coalesce(alarm_override, alarm_level).
create or replace function public.reconcile_findings()
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  -- drop findings whose asset has recovered (no point's latest reading is still
  -- Warning/Danger). Linked work orders survive — work_orders.finding_id is
  -- ON DELETE SET NULL and carries its own recommendation snapshot.
  delete from findings f
  where not exists (
    select 1 from (
      select distinct on (mp.id) c.equipment_id eq,
             coalesce(m.alarm_override, m.alarm_level) cond
      from measurements m
      join measurement_points mp on mp.id=m.measurement_point_id
      join components c on c.id=mp.component_id
      order by mp.id, m.measured_at desc
    ) latest
    where latest.eq = f.equipment_id and latest.cond in ('Warning','Danger')
  );

  with latest as (
    select distinct on (mp.id) c.equipment_id eq, e.company_id, e.location_id, e.tag,
           coalesce(m.alarm_override, m.alarm_level) cond
    from measurements m
    join measurement_points mp on mp.id=m.measurement_point_id
    join components c on c.id=mp.component_id
    join equipment e on e.id=c.equipment_id
    order by mp.id, m.measured_at desc
  ),
  worst as (
    select eq, (array_agg(company_id))[1] company_id, (array_agg(location_id))[1] location_id,
           (array_agg(tag))[1] tag,
           case when bool_or(cond='Danger') then 'Danger' else 'Warning' end w
    from latest where cond in ('Warning','Danger') group by eq
  )
  insert into findings (company_id, location_id, equipment_id, condition, generated_tag)
  select company_id, location_id, eq, w, tag
  from worst wt
  where not exists (select 1 from findings f where f.equipment_id = wt.eq and f.status <> 'closed');

  -- keep the condition of still-open findings in sync with the asset's worst point
  with latest as (
    select distinct on (mp.id) c.equipment_id eq,
           coalesce(m.alarm_override, m.alarm_level) cond
    from measurements m
    join measurement_points mp on mp.id=m.measurement_point_id
    join components c on c.id=mp.component_id
    order by mp.id, m.measured_at desc
  ),
  worst as (
    select eq, case when bool_or(cond='Danger') then 'Danger' else 'Warning' end w
    from latest where cond in ('Warning','Danger') group by eq
  )
  update findings f set condition = worst.w, updated_at=now()
  from worst where f.equipment_id = worst.eq and f.status <> 'closed' and f.condition <> worst.w;
end;
$$;
