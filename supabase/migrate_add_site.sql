-- Migration: Add `site` column for LMS support
-- Run this ONCE on production before deploying the updated ingest-scan function.
-- All existing rows default to 'resale' (backward-compatible).

-- 1) Add site column to all tables, default 'resale' backfills existing rows
ALTER TABLE scan_snapshots        ADD COLUMN site text NOT NULL DEFAULT 'resale';
ALTER TABLE seats                 ADD COLUMN site text NOT NULL DEFAULT 'resale';
ALTER TABLE match_summary         ADD COLUMN site text NOT NULL DEFAULT 'resale';
ALTER TABLE match_summary_history ADD COLUMN site text NOT NULL DEFAULT 'resale';

-- 2) Constrain valid values
ALTER TABLE scan_snapshots        ADD CONSTRAINT chk_ss_site   CHECK (site IN ('resale','lms'));
ALTER TABLE seats                 ADD CONSTRAINT chk_seats_site CHECK (site IN ('resale','lms'));
ALTER TABLE match_summary         ADD CONSTRAINT chk_ms_site   CHECK (site IN ('resale','lms'));
ALTER TABLE match_summary_history ADD CONSTRAINT chk_msh_site  CHECK (site IN ('resale','lms'));

-- 3) Repoint primary keys (collision prevention — same perfId across sites)
ALTER TABLE seats DROP CONSTRAINT seats_pkey;
ALTER TABLE seats ADD PRIMARY KEY (site, performance_id, seat_id);

ALTER TABLE match_summary DROP CONSTRAINT match_summary_pkey;
ALTER TABLE match_summary ADD PRIMARY KEY (site, performance_id);

-- 4) Indexes (drop old, add site-prefixed)
DROP INDEX IF EXISTS idx_seats_perf_price;
CREATE INDEX idx_seats_site_perf_price    ON seats          (site, performance_id, price);

DROP INDEX IF EXISTS idx_snapshots_perf;
DROP INDEX IF EXISTS idx_snapshots_perf_time;
CREATE INDEX idx_snapshots_site_perf      ON scan_snapshots (site, performance_id);
CREATE INDEX idx_snapshots_site_perf_time ON scan_snapshots (site, performance_id, scanned_at DESC);

DROP INDEX IF EXISTS idx_summary_history_perf;
CREATE UNIQUE INDEX uq_msh_site_perf_hour ON match_summary_history (site, performance_id, hour);
