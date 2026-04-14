-- FIFA Ticket Scout — Supabase schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query)

-- Scan audit log: one row per scan submission, with full seat data as JSONB
CREATE TABLE scan_snapshots (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  performance_id  text NOT NULL,
  visitor_id      text NOT NULL,
  license_hash    text,
  seat_count      int NOT NULL,
  seats_data      jsonb NOT NULL,
  currency        text DEFAULT 'USD',
  match_name      text,
  match_date      text,
  scanned_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_snapshots_perf ON scan_snapshots (performance_id);
CREATE INDEX idx_snapshots_time ON scan_snapshots (scanned_at DESC);
CREATE INDEX idx_snapshots_visitor ON scan_snapshots (visitor_id);
CREATE INDEX idx_snapshots_perf_time ON scan_snapshots (performance_id, scanned_at DESC);
CREATE INDEX idx_snapshots_visitor_time ON scan_snapshots (visitor_id, scanned_at DESC);

-- Latest state per seat, upserted on each scan
CREATE TABLE seats (
  performance_id  text NOT NULL,
  seat_id         text NOT NULL,
  block           text,
  area            text,
  row_label       text,
  seat_number     text,
  category        text,
  category_id     text,
  price           int,
  color           text,
  exclusive       boolean DEFAULT true,
  last_seen_at    timestamptz DEFAULT now(),
  first_seen_at   timestamptz DEFAULT now(),

  PRIMARY KEY (performance_id, seat_id)
);

CREATE INDEX idx_seats_perf_price ON seats (performance_id, price);

-- Current aggregated stats per match (one row per match, overwritten)
CREATE TABLE match_summary (
  performance_id  text PRIMARY KEY,
  match_name      text,
  match_date      text,
  currency        text DEFAULT 'USD',
  img_url         text,
  total_seats     int DEFAULT 0,
  available_seats int DEFAULT 0,
  min_price       int,
  max_price       int,
  median_price    int,
  categories      jsonb,
  last_scan_at    timestamptz,
  scan_count      int DEFAULT 0,
  unique_scanners int DEFAULT 0,
  updated_at      timestamptz DEFAULT now()
);

-- Alert configurations for Pro + Web + Alerts users
CREATE TABLE alert_configs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  license_hash    text NOT NULL UNIQUE,
  email           text NOT NULL,
  games           jsonb NOT NULL,
  games_locked    boolean DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  -- TTL for the alert config. Set on insert, never updated. To change later:
  --   ALTER TABLE alert_configs ALTER COLUMN expires_at SET DEFAULT (now() + interval '14 days');
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '180 days')
);

CREATE INDEX idx_alert_configs_license ON alert_configs (license_hash);

-- Append-only history of every alert config save (insert or update).
-- One row per save — lets you see how users change thresholds over time.
CREATE TABLE alert_configs_history (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  license_hash    text NOT NULL,
  email           text NOT NULL,
  games           jsonb NOT NULL,
  action          text NOT NULL,   -- 'insert' (first save) or 'update' (revision)
  saved_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_alert_history_license_time ON alert_configs_history (license_hash, saved_at DESC);
CREATE INDEX idx_alert_history_time ON alert_configs_history (saved_at DESC);

-- Alert fires — one row every time the dispatcher sends an email for a pick.
-- Used for dedup (cooldown window + re-drop detection) and audit.
CREATE TABLE alerts_sent (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  license_hash    text NOT NULL,
  email           text NOT NULL,
  match_number    int NOT NULL,
  performance_id  text NOT NULL,
  threshold       int NOT NULL,         -- the dollar cutoff the user set
  fired_price     int NOT NULL,         -- actual min price at fire time
  category        text,                 -- "any" | "CAT 1" | "CAT 2" | "CAT 3"
  fired_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_alerts_sent_dedup ON alerts_sent (license_hash, match_number, fired_at DESC);

-- Hourly snapshots for trend charts (append-only, one row per match per hour)
CREATE TABLE match_summary_history (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  performance_id  text NOT NULL,
  total_seats     int DEFAULT 0,
  available_seats int DEFAULT 0,
  min_price       int,
  max_price       int,
  median_price    int,
  hour            timestamptz NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_summary_history_perf ON match_summary_history (performance_id, hour DESC);

-- Row Level Security

-- scan_snapshots: only Edge Function (service_role) can read/write
ALTER TABLE scan_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON scan_snapshots FOR ALL USING (false);

-- seats: only Edge Function (service_role) can read/write
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON seats FOR ALL USING (false);

-- match_summary: anyone can read, only Edge Function can write
ALTER TABLE match_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON match_summary FOR SELECT USING (true);
CREATE POLICY "No direct inserts" ON match_summary FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates" ON match_summary FOR UPDATE USING (false);
CREATE POLICY "No direct deletes" ON match_summary FOR DELETE USING (false);

-- alert_configs: only Edge Function (service_role) can read/write
ALTER TABLE alert_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON alert_configs FOR ALL USING (false);

-- alert_configs_history: only Edge Function (service_role) can read/write
ALTER TABLE alert_configs_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON alert_configs_history FOR ALL USING (false);

-- alerts_sent: only the dispatcher (service_role) can read/write
ALTER TABLE alerts_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON alerts_sent FOR ALL USING (false);

-- match_summary_history: anyone can read, only Edge Function can write
ALTER TABLE match_summary_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON match_summary_history FOR SELECT USING (true);
CREATE POLICY "No direct inserts" ON match_summary_history FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates" ON match_summary_history FOR UPDATE USING (false);
CREATE POLICY "No direct deletes" ON match_summary_history FOR DELETE USING (false);
