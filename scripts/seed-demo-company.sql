-- ─────────────────────────────────────────────────────────────────────────────
-- Demo Company seed  (idempotent — safe to re-run)
--
-- Creates "Demo Company / Demo Location" for sales walkthroughs. IME admins get
-- it automatically in the header picker (ScopeContext gives ime_admin every
-- company; every other role only ever sees its own), so no login or second
-- environment is needed.
--
-- The asset tree is FICTIONAL and generated here. Only technical measurement
-- values are reused from real plants — never tags, paths, serials, photos,
-- notes, findings or recommendations.
--
-- SOURCE SELECTION: only points with >= 5 readings qualify, because a demo whose
-- trends read "Not enough data" sells nothing. Most production points are too
-- thin for that (1,728 have a single reading, 1,315 have two), so in practice
-- the depth comes from the one plant with real history. The alarm mix is then
-- balanced on top of that pool.
--
-- Dates are copied 1:1, which keeps every interval and trend shape exactly as
-- measured. To make the demo read as current instead, add a constant to
-- measured_at / measured_datetime in step 5 — nothing else depends on it.
--
-- Signal files are REFERENCED, not copied: waveform_path/fft_path keep pointing
-- at the original {location_id}/{mes_id} objects. Those paths carry UUIDs, not
-- plant names, and the uas-signals bucket policy is bucket-wide for
-- authenticated users, so the Ultrasound signal panel works unchanged.
--
-- UAS ISOLATION: demo rows get uas_uid = NULL and synced_at = NULL, and the
-- sync resolves work by matching UAS schema tokens to company names. "Demo
-- Company" matches nothing, so its location is never processed and the
-- destructive mark-and-sweep can never reach these rows.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- Stable ids so re-runs replace rather than accumulate.
create temp table demo_ids on commit drop as
select md5('ime-demo:company')::uuid  as co,
       md5('ime-demo:location')::uuid as loc;

-- ── 0. Wipe any previous demo ────────────────────────────────────────────────
-- findings.company_id and work_orders.company_id are plain FKs (no cascade), so
-- they must go before the company. Everything else cascades from companies.
-- Matched by NAME as well as id, to catch a demo seeded before ids were fixed.
delete from work_orders w using companies c
  where c.id = w.company_id and c.name = 'Demo Company';
delete from findings f using companies c
  where c.id = f.company_id and c.name = 'Demo Company';
delete from companies where name = 'Demo Company';

-- ── 1. Company + location ────────────────────────────────────────────────────
insert into companies (id, name, industry, country, status)
select co, 'Demo Company', 'Manufacturing', 'United States', 'active' from demo_ids;

insert into locations (id, company_id, name, next_visit_date)
select loc, co, 'Demo Location', current_date + 21 from demo_ids;

-- ── 2. Lines / sections ──────────────────────────────────────────────────────
insert into lines (id, location_id, company_id, name, uas_order)
select md5('ime-demo:line:' || v.name)::uuid, d.loc, d.co, v.name, v.ord
from demo_ids d, (values
  ('Packaging', 0), ('Process', 1), ('Utilities', 2), ('Warehouse', 3)
) as v(name, ord);

insert into sections (id, line_id, company_id, location_id, uas_name, uas_order)
select md5('ime-demo:section:' || v.line || ':' || v.sec)::uuid,
       l.id, d.co, d.loc, v.sec, v.ord
from demo_ids d
join (values
  ('Packaging','Filler to Capper',0), ('Packaging','Capper to Labeller',1),
  ('Packaging','Case Packer',2),      ('Packaging','Palletiser',3),
  ('Process','Mixing',0),             ('Process','Pasteuriser',1),
  ('Process','Syrup Room',2),         ('Process','CIP Skid',3),
  ('Utilities','Compressor Room',0),  ('Utilities','Chiller Plant',1),
  ('Utilities','Boiler House',2),
  ('Warehouse','Infeed Conveyors',0), ('Warehouse','Stretch Wrappers',1),
  ('Warehouse','Dock Conveyors',2)
) as v(line, sec, ord) on true
join lines l on l.id = md5('ime-demo:line:' || v.line)::uuid;

-- ── 3. Equipment (3 per section) ─────────────────────────────────────────────
-- Generic type/tag/specs so Equipment Detail looks populated without inventing
-- anything that could be mistaken for a real customer asset.
insert into equipment (id, section_id, company_id, location_id, tag, display_name,
                       asset_type, manufacturer, model, installation_date, status,
                       spec_rated_power, spec_rated_speed, uas_order)
select md5('ime-demo:equip:' || s.id::text || ':' || g.i)::uuid,
       s.id, d.co, d.loc,
       t.prefix || '-' || (100 + (row_number() over (partition by t.prefix order by s.uas_order, s.id, g.i))),
       t.kind || ' ' || g.i,
       t.kind,
       (array['Baldor','SEW-Eurodrive','WEG','Siemens'])[1 + (g.i + s.uas_order) % 4],
       'Series ' || (2000 + ((g.i * 7 + s.uas_order * 13) % 40)),
       date '2019-01-01' + ((g.i * 97 + s.uas_order * 31) % 1800),
       'active',
       (array['7.5 kW','11 kW','15 kW','22 kW','37 kW'])[1 + (g.i + s.uas_order) % 5],
       (array['1450 rpm','1750 rpm','2900 rpm','980 rpm'])[1 + (g.i * 3 + s.uas_order) % 4],
       g.i - 1
from demo_ids d
join sections s on s.company_id = d.co
cross join generate_series(1, 3) as g(i)
cross join lateral (
  select (array['Pump','Compressor','Motor','Fan','Blower','Gearbox'])[1 + ((s.uas_order * 3 + g.i) % 6)] as kind,
         (array['P','C','M','F','B','G'])[1 + ((s.uas_order * 3 + g.i) % 6)] as prefix
) t;

-- ── 4. Components + points ───────────────────────────────────────────────────
-- Every third asset gets a second component, so the tree is not uniform.
insert into components (id, equipment_id, company_id, location_id, name, uas_order)
select md5('ime-demo:comp:' || e.id::text || ':' || c.i)::uuid,
       e.id, d.co, d.loc,
       (array['Motor','Gearbox'])[c.i], c.i - 1
from demo_ids d
join equipment e on e.company_id = d.co
cross join lateral generate_series(
  1, case when ('x' || substr(md5(e.id::text), 1, 8))::bit(32)::int % 3 = 0 then 2 else 1 end
) as c(i);

insert into measurement_points (id, component_id, company_id, location_id, name, sensor_model, uas_order)
select md5('ime-demo:point:' || cp.id::text || ':' || p.i)::uuid,
       cp.id, d.co, d.loc,
       case when cp.name = 'Motor'
            then (array['DE Motor','NDE Motor'])[p.i]
            else (array['G-Inp','G-Out'])[p.i] end,
       'RS1',
       p.i - 1
from demo_ids d
join components cp on cp.company_id = d.co
cross join generate_series(1, 2) as p(i);

-- ── 5. Remap real measurement histories onto demo points ─────────────────────
create temp table demo_map on commit drop as
with pool as (
  select m.measurement_point_id as mp,
         count(*) as n,
         (array_agg(coalesce(m.alarm_override, m.alarm_level) order by m.measured_at desc))[1] as latest
  from measurements m
  group by 1
  having count(*) >= 5                        -- real trend, not a single dot
),
ranked as (
  select mp, latest, row_number() over (partition by latest order by md5(mp::text)) as rn
  from pool
  where latest in ('Danger','Warning','Alert','Normal')
),
-- A deliberately demo-friendly mix: enough Danger/Warning to populate Findings
-- and Work Orders, still dominated by Normal so it reads like a real fleet.
picked as (
  select mp, latest,
         row_number() over (
           order by case latest when 'Danger' then 1 when 'Warning' then 2
                                when 'Alert' then 3 else 4 end, rn) as pick_no
  from ranked
  where (latest = 'Danger'  and rn <= 14)
     or (latest = 'Warning' and rn <= 10)
     or (latest = 'Alert'   and rn <= 10)
     or (latest = 'Normal'  and rn <= 78)
),
-- Ordering demo points by hash scatters the alarms through the tree instead of
-- stacking every Danger onto the first few assets.
demo as (
  select mp.id as demo_mp, row_number() over (order by md5(mp.id::text)) as slot
  from measurement_points mp
  join demo_ids d on d.co = mp.company_id
)
select demo.demo_mp, picked.mp as src_mp, picked.latest
from demo join picked on picked.pick_no = demo.slot;

update measurement_points t
set bearing_rotating_speed = s.bearing_rotating_speed
from demo_map dm
join measurement_points s on s.id = dm.src_mp
where t.id = dm.demo_mp and s.bearing_rotating_speed is not null;

-- crest_factor and alarm_level are GENERATED — never inserted. alarm_override
-- is deliberately not carried over: a demo should show computed levels.
insert into measurements (
  measurement_point_id, company_id, location_id,
  overall_rms, max_rms, peak, measured_at, measured_datetime,
  waveform_path, fft_path, sample_rate, fft_length, fft_window)
select dm.demo_mp, d.co, d.loc,
       m.overall_rms, m.max_rms, m.peak, m.measured_at, m.measured_datetime,
       m.waveform_path, m.fft_path, m.sample_rate, m.fft_length, m.fft_window
from demo_ids d
join demo_map dm on true
join measurements m on m.measurement_point_id = dm.src_mp;

-- ── 6. Findings, generic recommendations, work orders ────────────────────────
select reconcile_findings();

update findings f
set finding = r.finding, recommendation = r.rec, updated_at = now()
from (
  select id, row_number() over (order by condition, created_at, id) as rn
  from findings where company_id = md5('ime-demo:company')::uuid
) ranked
join (values
  (1, 'Friction signature consistent with inadequate lubrication.',
      'Re-lubricate the bearing with the specified grease and re-measure within two weeks. If the ultrasound level does not fall, plan a bearing inspection.'),
  (2, 'Early-stage bearing defect indicated by repetitive impacting.',
      'Trend weekly and schedule bearing replacement at the next planned shutdown. Confirm the defect frequency against the bearing geometry before ordering parts.'),
  (3, 'Impacting pattern consistent with shaft misalignment.',
      'Verify coupling alignment and check for soft foot. Re-measure after correction to confirm the ultrasound level returns to baseline.'),
  (4, 'Turbulent flow consistent with a compressed-air leak near the actuator.',
      'Isolate the branch and repair the leaking fitting. Re-survey the line afterwards to quantify the recovered air demand.'),
  (5, 'Elevated friction on the drive end with no impacting present.',
      'Inspect for grease contamination and confirm the correct lubricant type is in use. Increase monitoring frequency until the trend stabilises.')
) as r(slot, finding, rec) on r.slot = ((ranked.rn - 1) % 5) + 1
where f.id = ranked.id and ranked.rn <= 10;

-- Work orders on five distinct assets — work_orders_single_active allows only
-- one open/in_progress WO per asset, so statuses are spread deliberately.
insert into work_orders (company_id, location_id, equipment_id, finding_id, title, description,
                         recommendation, priority, status, assignee, due_date, close_note)
select md5('ime-demo:company')::uuid, md5('ime-demo:location')::uuid,
       f.equipment_id, f.id,
       w.title, w.descr, f.recommendation, w.priority, w.status, w.assignee,
       current_date + w.due_offset,
       case when w.status = 'closed' then 'Repair completed and ultrasound level returned to baseline.' end
from (
  select f.*, row_number() over (order by case f.condition when 'Danger' then 0 else 1 end, f.created_at, f.id) as rn
  from findings f where f.company_id = md5('ime-demo:company')::uuid
) f
join (values
  (1, 'Bearing re-lubrication',       'Re-lubricate and re-measure per analyst recommendation.', 'high',     'in_progress', 'M. Alvarez', 7),
  (2, 'Bearing replacement',          'Replace bearing at next planned shutdown.',               'critical', 'open',        'J. Whitfield', 21),
  (3, 'Coupling alignment check',     'Verify alignment and soft foot on the drive train.',      'medium',   'open',        'R. Osei',      14),
  (4, 'Compressed-air leak repair',   'Isolate branch and repair the leaking fitting.',          'medium',   'closed',      'T. Nakamura', -3),
  (5, 'Drive-end inspection',         'Inspect for grease contamination and verify lubricant.',  'low',      'closed',      'S. Kaur',     -10)
) as w(slot, title, descr, priority, status, assignee, due_offset) on w.slot = f.rn;

update findings f
set status = 'wo_created', work_order_id = w.id, updated_at = now()
from work_orders w
where w.finding_id = f.id and f.company_id = md5('ime-demo:company')::uuid;

commit;
