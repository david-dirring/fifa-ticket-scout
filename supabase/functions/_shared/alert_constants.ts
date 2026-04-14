// Single source of truth for alert config limits.
// Imported by save-alerts and get-alerts. Both functions return MAX_PICKS in
// their JSON responses so the popup never has to hardcode it.
//
// To change the per-user pick limit:
//   1. Edit MAX_PICKS below
//   2. supabase functions deploy save-alerts
//   3. supabase functions deploy get-alerts
//   4. Existing extension installs auto-pick-up via get-alerts response.
//
// EXPIRES_DAYS is reserved — currently the alert_configs.expires_at column
// has its own SQL DEFAULT (now() + interval '180 days'). If a future change
// wants the Edge Function to set expires_at explicitly on insert, this is
// where the value lives.

export const MAX_PICKS = 3;
export const EXPIRES_DAYS = 180;
