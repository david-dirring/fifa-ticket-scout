import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_PICKS } from "../_shared/alert_constants.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Same Pro+Web+Alerts product ID as save-alerts. Only level-30 licenses
// can read alert configs (no anon access ever — alert_configs has RLS
// `USING (false)` so the service role is the only way in).
const ALERTS_PRODUCT_ID = "HEzB2VDD6QMDXaFiynXo5w==";
const GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();
    const { licenseKey } = body;

    if (!licenseKey || typeof licenseKey !== "string") {
      return jsonResponse({ ok: false, error: "Missing license key" }, 400);
    }

    // --- Verify license with Gumroad (must be tier 30) ---
    const verifyResp = await fetch(GUMROAD_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        product_id: ALERTS_PRODUCT_ID,
        license_key: licenseKey.trim(),
        increment_uses_count: "false",
      }),
    });
    const verifyResult = await verifyResp.json();

    if (!verifyResult.success) {
      return jsonResponse(
        { ok: false, error: "License not valid for Alerts tier" },
        403
      );
    }

    // --- Hash license server-side ---
    const licenseHash = await sha256(licenseKey.trim());

    // --- Read the user's saved alert config ---
    const { data: row, error: selectError } = await supabase
      .from("alert_configs")
      .select("email, games, games_locked, created_at, updated_at, expires_at")
      .eq("license_hash", licenseHash)
      .maybeSingle();

    if (selectError) {
      console.error("get-alerts select error:", selectError);
      return jsonResponse({ ok: false, error: "Read failed" }, 500);
    }

    if (!row) {
      // License is valid but user has never saved alerts yet.
      // Return an empty config so the popup renders the fresh-input form.
      return jsonResponse({
        ok: true,
        email: null,
        games: [],
        gamesLocked: false,
        savedAt: null,
        updatedAt: null,
        expiresAt: null,
        maxPicks: MAX_PICKS,
      });
    }

    return jsonResponse({
      ok: true,
      email: row.email,
      games: row.games || [],
      gamesLocked: row.games_locked !== false,
      savedAt: row.created_at ? new Date(row.created_at).getTime() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).getTime() : null,
      maxPicks: MAX_PICKS,
    });
  } catch (err) {
    console.error("get-alerts error:", err);
    return jsonResponse({ ok: false, error: "Server error" }, 500);
  }
});
