import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MAX_PICKS, getMaxPicks } from "../_shared/alert_constants.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Gumroad product IDs — only level 30 (Pro + Web + Alerts) can register alerts
const ALERTS_PRODUCT_ID = "HEzB2VDD6QMDXaFiynXo5w==";
const GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

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
    const { licenseKey, email, games } = body;

    // --- Validate inputs ---
    if (!licenseKey || typeof licenseKey !== "string") {
      return jsonResponse({ ok: false, error: "Missing license key" }, 400);
    }
    if (!email || typeof email !== "string") {
      return jsonResponse({ ok: false, error: "Missing email" }, 400);
    }
    if (!EMAIL_REGEX.test(email)) {
      return jsonResponse({ ok: false, error: "Invalid email format" }, 400);
    }
    if (/[,;\s]/.test(email)) {
      return jsonResponse({ ok: false, error: "Only one email address allowed" }, 400);
    }

    // Hash early so we can look up per-license pick limits before validation.
    const licenseHash = await sha256(licenseKey.trim());
    const effectiveMax = getMaxPicks(licenseHash);

    if (!Array.isArray(games) || games.length === 0 || games.length > effectiveMax) {
      return jsonResponse({ ok: false, error: `Must have 1-${effectiveMax} games` }, 400);
    }

    // Validate each game
    for (const g of games) {
      if (!g.match_number || typeof g.match_number !== "number") {
        return jsonResponse({ ok: false, error: "Invalid match_number" }, 400);
      }
      if (!g.threshold || typeof g.threshold !== "number" || g.threshold <= 0) {
        return jsonResponse({ ok: false, error: "Invalid price threshold" }, 400);
      }
    }

    // --- Verify license with Gumroad (must be level 30) ---
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

    // --- Check for existing config ---
    const { data: existing } = await supabase
      .from("alert_configs")
      .select("email, games")
      .eq("license_hash", licenseHash)
      .maybeSingle();

    if (existing) {
      // Email lock: reject any change
      if (existing.email !== email) {
        return jsonResponse(
          { ok: false, error: "Email is locked to this license. Contact support to change." },
          403
        );
      }

      // expires_at intentionally NOT touched on update — TTL stays frozen
      // from the original insert.
      const { error: updateError } = await supabase
        .from("alert_configs")
        .update({
          games,
          updated_at: new Date().toISOString(),
        })
        .eq("license_hash", licenseHash);

      if (updateError) {
        console.error("update error:", updateError);
        return jsonResponse({ ok: false, error: "Update failed" }, 500);
      }

      // Append to history (best-effort; don't fail the save if it errors)
      const { error: historyError } = await supabase
        .from("alert_configs_history")
        .insert({ license_hash: licenseHash, email, games, action: "update" });
      if (historyError) console.error("history update error:", historyError);

      return jsonResponse({ ok: true, maxPicks: effectiveMax });
    }

    // --- Insert new config ---
    // expires_at uses the SQL column DEFAULT (now() + interval '180 days').
    const { error: insertError } = await supabase.from("alert_configs").insert({
      license_hash: licenseHash,
      email,
      games,
    });

    if (insertError) {
      console.error("insert error:", insertError);
      return jsonResponse({ ok: false, error: "Save failed" }, 500);
    }

    // Append to history (best-effort; don't fail the save if it errors)
    const { error: historyError } = await supabase
      .from("alert_configs_history")
      .insert({ license_hash: licenseHash, email, games, action: "insert" });
    if (historyError) console.error("history insert error:", historyError);

    return jsonResponse({ ok: true, maxPicks: effectiveMax });
  } catch (err) {
    console.error("save-alerts error:", err);
    return jsonResponse({ ok: false, error: "Server error" }, 500);
  }
});
