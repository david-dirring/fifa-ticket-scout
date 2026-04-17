-- Migration: Remote scan config table
-- Single-row config for scan timing. Tunable via SQL editor (service_role bypasses RLS).

CREATE TABLE scan_config (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  profiles     jsonb NOT NULL DEFAULT '{
    "aggressive": {"min": 0,    "max": 0},
    "balanced":   {"min": 600,  "max": 1000},
    "cautious":   {"min": 1200, "max": 1800},
    "stealth":    {"min": 1300, "max": 2700}
  }',
  tile_size              int NOT NULL DEFAULT 10000,
  map_max                int NOT NULL DEFAULT 40000,
  max_consecutive_blocks int NOT NULL DEFAULT 3,
  retry_cooldown_ms      int NOT NULL DEFAULT 3000,
  updated_at             timestamptz DEFAULT now()
);

INSERT INTO scan_config (id) VALUES (1);

ALTER TABLE scan_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON scan_config FOR SELECT USING (true);
CREATE POLICY "No direct writes" ON scan_config FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates" ON scan_config FOR UPDATE USING (false);
CREATE POLICY "No direct deletes" ON scan_config FOR DELETE USING (false);
