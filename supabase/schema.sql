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

-- match_summary_history: anyone can read, only Edge Function can write
ALTER TABLE match_summary_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON match_summary_history FOR SELECT USING (true);
CREATE POLICY "No direct inserts" ON match_summary_history FOR INSERT WITH CHECK (false);
CREATE POLICY "No direct updates" ON match_summary_history FOR UPDATE USING (false);
CREATE POLICY "No direct deletes" ON match_summary_history FOR DELETE USING (false);
