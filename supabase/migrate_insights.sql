-- ============================================================
-- Insights: "priced to sell" materialized table + pg_cron
-- ============================================================

-- 1. Results table (refreshed daily by pg_cron)
CREATE TABLE IF NOT EXISTS insights_priced_to_sell (
  site                  text NOT NULL,
  performance_id        text NOT NULL,
  scan_date             date NOT NULL,
  match_number          text,
  teams                 text,
  stadium               text,
  match_date            text,
  category              text NOT NULL DEFAULT '',
  avg_priced_to_sell    numeric,
  total_seats           int NOT NULL DEFAULT 0,
  seats_in_bottom_15    int NOT NULL DEFAULT 0,
  PRIMARY KEY (site, performance_id, scan_date, category)
);

ALTER TABLE insights_priced_to_sell ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No direct access" ON insights_priced_to_sell USING (false);

-- 2. Function that truncates + re-fills the table
CREATE OR REPLACE FUNCTION refresh_priced_to_sell()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE insights_priced_to_sell;

  INSERT INTO insights_priced_to_sell
    (site, performance_id, scan_date, match_number, teams, stadium,
     match_date, category, avg_priced_to_sell, total_seats, seats_in_bottom_15)
  WITH max_scan_per_day AS (
    SELECT DISTINCT ON (site, performance_id, scan_date)
      site,
      performance_id,
      (scanned_at AT TIME ZONE 'UTC')::date AS scan_date,
      id AS snapshot_id,
      seat_count,
      seats_data,
      currency,
      match_name,
      match_date,
      scanned_at
    FROM scan_snapshots
    WHERE site = 'resale'
      AND currency = 'USD'
      AND (scanned_at AT TIME ZONE 'UTC')::date >= CURRENT_DATE - 7
      AND (scanned_at AT TIME ZONE 'UTC')::date <  CURRENT_DATE
    ORDER BY
      site,
      performance_id,
      scan_date,
      seat_count DESC,
      scanned_at DESC
  ),
  seats AS (
    SELECT
      m.site,
      m.performance_id,
      m.scan_date,
      m.match_name,
      m.match_date,
      m.currency,
      TRIM(SPLIT_PART(m.match_name, ' / ', 2)) AS match_number,
      TRIM(SPLIT_PART(m.match_name, ' / ', 3)) AS teams,
      TRIM(SPLIT_PART(m.match_name, ' / ', 4)) AS stadium,
      COALESCE(s.value ->> 'category', '')      AS category,
      (s.value ->> 'price')::bigint / 1000.0 * 1.15 AS display_price
    FROM max_scan_per_day m,
         jsonb_each(m.seats_data) AS s(seat_key, value)
  ),
  with_totals AS (
    SELECT *,
      COUNT(*) OVER (PARTITION BY site, performance_id, scan_date) AS day_total,
      PERCENT_RANK() OVER (
        PARTITION BY site, performance_id, scan_date
        ORDER BY display_price
      ) AS pct_rank
    FROM seats
  )
  SELECT
    site,
    performance_id,
    scan_date,
    match_number,
    teams,
    stadium,
    match_date,
    category,
    ROUND(AVG(display_price)::numeric, 2) AS avg_priced_to_sell,
    MAX(day_total)::int                    AS total_seats,
    COUNT(*)::int                          AS seats_in_bottom_15
  FROM with_totals
  WHERE pct_rank <= 0.15
  GROUP BY site, performance_id, scan_date, match_number, teams, stadium, match_date, category;
END;
$$;

-- 3. Schedule daily at 00:05 UTC (enable pg_cron first if needed)
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-insights', '5 0 * * *', 'SELECT refresh_priced_to_sell()');

-- 4. Seed the table now
SELECT refresh_priced_to_sell();
