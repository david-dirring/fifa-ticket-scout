// Server-side ceiling for alert pick limits.
// The real business limit is controlled by max_picks in scan_config.json
// (fetched from GitHub by the extension). This constant is a safety cap
// to prevent abuse — set generously above the expected config value.
//
// EXPIRES_DAYS is reserved — currently the alert_configs.expires_at column
// has its own SQL DEFAULT (now() + interval '180 days'). If a future change
// wants the Edge Function to set expires_at explicitly on insert, this is
// where the value lives.

export const MAX_PICKS = 10;
export const EXPIRES_DAYS = 180;
