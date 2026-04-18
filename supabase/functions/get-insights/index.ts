import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const PRODUCT_ID = "HEzB2VDD6QMDXaFiynXo5w==";
const GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify";

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
        product_id: PRODUCT_ID,
        license_key: licenseKey.trim(),
        increment_uses_count: "false",
      }),
    });
    const verifyResult = await verifyResp.json();

    if (!verifyResult.success) {
      return jsonResponse(
        { ok: false, error: "License not valid for Insights tier" },
        403
      );
    }

    // --- Read pre-computed insights ---
    const { data, error } = await supabase
      .from("insights_priced_to_sell")
      .select("*");

    if (error) {
      console.error("get-insights select error:", error);
      return jsonResponse({ ok: false, error: "Query failed" }, 500);
    }

    return jsonResponse({ ok: true, data: data || [] });
  } catch (err) {
    console.error("get-insights error:", err);
    return jsonResponse({ ok: false, error: "Server error" }, 500);
  }
});
