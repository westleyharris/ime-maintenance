-- ── Asset Lifecycle Migration ──────────────────────────────────────────────────
-- Run this in Supabase SQL Editor

-- 1. Extend equipment table
ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS status      text    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'replaced')),
  ADD COLUMN IF NOT EXISTS status_note text,
  ADD COLUMN IF NOT EXISTS last_replaced_at timestamptz;

-- 2. Equipment notes / activity log
CREATE TABLE IF NOT EXISTS equipment_notes (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  equipment_id  uuid        NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  note_type     text        NOT NULL DEFAULT 'general'
                              CHECK (note_type IN ('general', 'status_change', 'replacement')),
  message       text,
  metadata      jsonb,
  created_at    timestamptz DEFAULT now()
);

-- 3. RLS for equipment_notes
ALTER TABLE equipment_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read notes"
  ON equipment_notes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert notes"
  ON equipment_notes FOR INSERT TO authenticated WITH CHECK (true);

-- 4. Index for fast lookups
CREATE INDEX IF NOT EXISTS equipment_notes_equipment_id_idx
  ON equipment_notes (equipment_id, created_at DESC);
