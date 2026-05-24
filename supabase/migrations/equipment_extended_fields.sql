-- ── Equipment Extended Fields Migration ───────────────────────────────────────
-- Run this in Supabase SQL Editor BEFORE using asset detail features.
-- All columns use ADD COLUMN IF NOT EXISTS so it is safe to run multiple times.

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS display_name       text,
  ADD COLUMN IF NOT EXISTS asset_type         text,
  ADD COLUMN IF NOT EXISTS manufacturer       text,
  ADD COLUMN IF NOT EXISTS model              text,
  ADD COLUMN IF NOT EXISTS serial_number      text,
  ADD COLUMN IF NOT EXISTS installation_date  date,
  ADD COLUMN IF NOT EXISTS location_notes     text,
  ADD COLUMN IF NOT EXISTS spec_rated_power   text,
  ADD COLUMN IF NOT EXISTS spec_rated_speed   text,
  ADD COLUMN IF NOT EXISTS spec_flow_rate     text,
  ADD COLUMN IF NOT EXISTS spec_pressure      text,
  ADD COLUMN IF NOT EXISTS spec_temperature   text,
  ADD COLUMN IF NOT EXISTS spec_weight        text;

-- image_url was added in the initial schema; this is a no-op if it already exists
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS image_url text;
