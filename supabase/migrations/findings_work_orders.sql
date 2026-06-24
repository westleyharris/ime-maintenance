-- ─────────────────────────────────────────────────────────────────────────────
-- Findings + Work Orders
--
-- Findings auto-derive from measurement points whose LATEST reading is Warning or
-- Danger (reconcile_findings()), and persist with an Open → WO Created → Closed
-- lifecycle. An expert (ime_admin) fills the recommendation and creates a work
-- order, which links the finding to the asset.
-- ─────────────────────────────────────────────────────────────────────────────

create sequence if not exists public.wo_number_seq;

-- ── Work orders ───────────────────────────────────────────────────────────────
create table if not exists public.work_orders (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  location_id  uuid references public.locations(id),
  equipment_id uuid references public.equipment(id),
  finding_id   uuid,                                   -- FK added after findings exists
  wo_number    text not null unique default ('WO-' || lpad(nextval('public.wo_number_seq')::text, 5, '0')),
  title        text,
  description  text,
  priority     text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status       text not null default 'open'   check (status in ('open','in_progress','closed','cancelled')),
  assignee     text,
  sap_no       text,
  due_date     date,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists work_orders_company_idx   on public.work_orders(company_id);
create index if not exists work_orders_location_idx  on public.work_orders(location_id);
create index if not exists work_orders_equipment_idx on public.work_orders(equipment_id);
create index if not exists work_orders_finding_idx   on public.work_orders(finding_id);

-- ── Findings ──────────────────────────────────────────────────────────────────
create table if not exists public.findings (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  location_id          uuid references public.locations(id),
  measurement_point_id uuid not null references public.measurement_points(id) on delete cascade,
  condition            text not null check (condition in ('Warning','Danger')),
  finding              text,                            -- description (expert)
  recommendation       text,                            -- expert fills in
  generated_tag        text,
  sap_no               text,
  wo_text              text,
  bearings_info        text,
  comments             text,
  creation_date        date not null default current_date,
  status               text not null default 'open' check (status in ('open','wo_created','closed')),
  work_order_id        uuid references public.work_orders(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists findings_company_idx  on public.findings(company_id);
create index if not exists findings_location_idx on public.findings(location_id);
create index if not exists findings_point_idx    on public.findings(measurement_point_id);
create index if not exists findings_status_idx   on public.findings(status);
-- at most one non-closed finding per point (keeps auto-derive idempotent)
create unique index if not exists findings_one_open_per_point
  on public.findings(measurement_point_id) where status <> 'closed';

alter table public.work_orders
  add constraint work_orders_finding_fk
  foreign key (finding_id) references public.findings(id) on delete set null;

-- ── Auto-derive: create an open finding for each Warning/Danger point ──────────
create or replace function public.reconcile_findings()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- drop findings whose point has recovered (latest reading no longer Warning/
  -- Danger) so the list is always dynamic to current condition. Linked work orders
  -- survive (work_orders.finding_id is ON DELETE SET NULL) and keep their own asset link.
  delete from findings f
  where not exists (
    select 1 from (
      select distinct on (mp.id) mp.id as mp_id, m.alarm_level as condition
      from measurements m
      join measurement_points mp on mp.id = m.measurement_point_id
      order by mp.id, m.measured_at desc
    ) latest
    where latest.mp_id = f.measurement_point_id and latest.condition in ('Warning','Danger')
  );

  with latest as (
    select distinct on (mp.id)
      mp.id          as mp_id,
      mp.company_id  as company_id,
      m.location_id  as location_id,
      m.alarm_level  as condition,
      e.tag          as tag
    from measurements m
    join measurement_points mp on mp.id = m.measurement_point_id
    join components c          on c.id  = mp.component_id
    join equipment  e          on e.id  = c.equipment_id
    order by mp.id, m.measured_at desc
  )
  insert into findings (company_id, location_id, measurement_point_id, condition, generated_tag)
  select l.company_id, l.location_id, l.mp_id, l.condition, l.tag
  from latest l
  where l.condition in ('Warning','Danger')
    and not exists (
      select 1 from findings f where f.measurement_point_id = l.mp_id
    );

  -- keep the condition of still-open findings in sync with the latest reading
  with latest as (
    select distinct on (mp.id) mp.id as mp_id, m.alarm_level as condition
    from measurements m
    join measurement_points mp on mp.id = m.measurement_point_id
    order by mp.id, m.measured_at desc
  )
  update findings f
  set condition = l.condition, updated_at = now()
  from latest l
  where f.measurement_point_id = l.mp_id
    and f.status <> 'closed'
    and l.condition in ('Warning','Danger')
    and f.condition <> l.condition;
end;
$$;

grant execute on function public.reconcile_findings() to authenticated, anon;

-- ── RLS — read for any authenticated user, writes for ime_admin only ──────────
do $$
declare t text;
begin
  foreach t in array array['work_orders','findings'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy "authenticated read" on public.%I
        for select to authenticated using (true);
    $f$, t);
    execute format($f$
      create policy "ime_admin full access" on public.%I
        for all using (
          coalesce(((auth.jwt() -> 'app_metadata') ->> 'role'), '') = 'ime_admin'
        );
    $f$, t);
  end loop;
end $$;
