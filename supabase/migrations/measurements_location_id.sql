-- ── Add location_id to measurements ───────────────────────────────────────────
-- This allows direct, reliable filtering of measurements by location.
-- Deep nested PostgREST filters (5+ levels) are not reliable.
-- Run this in Supabase SQL Editor.

ALTER TABLE measurements
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES locations(id);

-- Backfill location_id for all existing measurements via the join chain:
-- measurements → measurement_points → components → equipment → sections → lines → (lines.location_id)
UPDATE measurements m
SET location_id = li.location_id
FROM measurement_points mp
JOIN components c  ON c.id  = mp.component_id
JOIN equipment  e  ON e.id  = c.equipment_id
JOIN sections   s  ON s.id  = e.section_id
JOIN lines      li ON li.id = s.line_id
WHERE m.measurement_point_id = mp.id
  AND m.location_id IS NULL;

-- Optional index for fast location filtering
CREATE INDEX IF NOT EXISTS measurements_location_id_idx ON measurements(location_id);
