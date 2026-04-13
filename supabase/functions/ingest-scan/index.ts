import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Validation regexes
const VISITOR_ID_RE = /^[a-f0-9]{32}$/i;
const PERFORMANCE_ID_RE = /^\d{5,20}$/;
const RATE_LIMIT_PER_MINUTE = 10;
const MIN_SEAT_COUNT = 10;
const MAX_SEAT_COUNT = 15000;
const MIN_PRICE_MILLICENTS = 1000;        // ~$1
const MAX_PRICE_MILLICENTS = 100000000;   // ~$100k
const MAX_FIELD_LENGTH = 100;

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
    const { visitorId, licenseHash, performanceId, match, seats } = body;

    // --- Visitor ID validation ---
    if (!visitorId || typeof visitorId !== "string" || !VISITOR_ID_RE.test(visitorId)) {
      return jsonResponse({ ok: false, error: "Invalid visitorId format" }, 400);
    }

    // --- Performance ID validation ---
    if (!performanceId || typeof performanceId !== "string" || !PERFORMANCE_ID_RE.test(performanceId)) {
      return jsonResponse({ ok: false, error: "Invalid performanceId format" }, 400);
    }

    // --- Seats structure validation ---
    if (!seats || typeof seats !== "object" || Array.isArray(seats)) {
      return jsonResponse({ ok: false, error: "Invalid seats payload" }, 400);
    }

    const seatEntries = Object.entries(seats);
    if (seatEntries.length < MIN_SEAT_COUNT || seatEntries.length > MAX_SEAT_COUNT) {
      return jsonResponse(
        { ok: false, error: `Seat count must be between ${MIN_SEAT_COUNT} and ${MAX_SEAT_COUNT}` },
        400
      );
    }

    // --- Match name validation (must look like FIFA data) ---
    const matchName = match?.name || "";
    if (!matchName.includes("Match ") && !matchName.includes("FIFA")) {
      return jsonResponse({ ok: false, error: "Invalid match name" }, 400);
    }

    // --- Per-seat validation ---
    const priceCounts: Record<string, number> = {};
    for (const [seatId, s] of seatEntries) {
      const seat = s as any;
      if (typeof seatId !== "string" || seatId.length > MAX_FIELD_LENGTH) {
        return jsonResponse({ ok: false, error: "Invalid seat ID" }, 400);
      }
      if (typeof seat.price !== "number" || seat.price < MIN_PRICE_MILLICENTS || seat.price > MAX_PRICE_MILLICENTS) {
        return jsonResponse({ ok: false, error: "Seat price out of range" }, 400);
      }
      // Field length checks
      for (const field of ["block", "area", "row", "seat", "category"]) {
        const val = seat[field];
        if (val != null && (typeof val !== "string" || val.length > MAX_FIELD_LENGTH)) {
          return jsonResponse({ ok: false, error: `Invalid seat.${field}` }, 400);
        }
      }
      // Track price frequency
      priceCounts[seat.price] = (priceCounts[seat.price] || 0) + 1;
    }

    // Reject if >50% of seats have the same price (synthetic data)
    const maxSamePrice = Math.max(...Object.values(priceCounts));
    if (maxSamePrice / seatEntries.length > 0.5) {
      return jsonResponse({ ok: false, error: "Suspicious price distribution" }, 400);
    }

    // --- Rate limiting per visitor_id ---
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("scan_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("visitor_id", visitorId)
      .gte("scanned_at", oneMinuteAgo);

    if ((recentCount || 0) >= RATE_LIMIT_PER_MINUTE) {
      return jsonResponse(
        { ok: false, error: "Rate limit exceeded" },
        429
      );
    }

    // 1. Insert scan snapshot with JSONB seat data
    const { error: snapError } = await supabase.from("scan_snapshots").insert({
      performance_id: performanceId,
      visitor_id: visitorId,
      license_hash: licenseHash || null,
      seat_count: seatEntries.length,
      seats_data: seats,
      currency: match?.currency || "USD",
      match_name: match?.name || null,
      match_date: match?.date || null,
    });

    if (snapError) {
      console.error("scan_snapshots insert error:", snapError);
    }

    // 2. Replace seats for this match (delete old, insert fresh)
    const { error: deleteError } = await supabase
      .from("seats")
      .delete()
      .eq("performance_id", performanceId);

    if (deleteError) {
      console.error("seats delete error:", deleteError);
    }

    const now = new Date().toISOString();
    const seatRows = seatEntries.map(([seatId, s]: [string, any]) => ({
      performance_id: performanceId,
      seat_id: seatId,
      block: s.block || null,
      area: s.area || null,
      row_label: s.row || null,
      seat_number: s.seat || null,
      category: s.category || null,
      category_id: s.categoryId || null,
      price: s.price ?? null,
      color: s.color || null,
      exclusive: s.exclusive ?? true,
      last_seen_at: now,
      first_seen_at: now,
    }));

    // Insert in chunks of 500
    for (let i = 0; i < seatRows.length; i += 500) {
      const chunk = seatRows.slice(i, i + 500);
      const { error: seatError } = await supabase
        .from("seats")
        .insert(chunk);

      if (seatError) {
        console.error(`seats insert error (chunk ${i}):`, seatError);
      }
    }

    // 3. Recompute match_summary
    const { data: seatStats } = await supabase
      .from("seats")
      .select("price, exclusive, category, color")
      .eq("performance_id", performanceId);

    if (seatStats && seatStats.length > 0) {
      const available = seatStats.filter((s) => s.exclusive !== false && s.price != null);
      const prices = available.map((s) => s.price).sort((a, b) => a - b);

      const medianPrice = prices.length > 0
        ? prices[Math.floor(prices.length / 2)]
        : null;

      // Category breakdown
      const catMap: Record<string, { count: number; minPrice: number; maxPrice: number; color: string }> = {};
      for (const s of available) {
        const cat = s.category || "Unknown";
        if (!catMap[cat]) {
          catMap[cat] = { count: 0, minPrice: s.price, maxPrice: s.price, color: s.color || "" };
        }
        catMap[cat].count++;
        if (s.price < catMap[cat].minPrice) catMap[cat].minPrice = s.price;
        if (s.price > catMap[cat].maxPrice) catMap[cat].maxPrice = s.price;
      }
      const categories = Object.entries(catMap).map(([name, d]) => ({
        name,
        count: d.count,
        minPrice: d.minPrice,
        maxPrice: d.maxPrice,
        color: d.color,
      }));

      // Count unique scanners
      const { count: uniqueScanners } = await supabase
        .from("scan_snapshots")
        .select("visitor_id", { count: "exact", head: true })
        .eq("performance_id", performanceId);

      // Get current scan count
      const { count: scanCount } = await supabase
        .from("scan_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("performance_id", performanceId);

      const { error: summaryError } = await supabase.from("match_summary").upsert(
        {
          performance_id: performanceId,
          match_name: match?.name || null,
          match_date: match?.date || null,
          currency: match?.currency || "USD",
          img_url: match?.imgUrl || null,
          total_seats: seatStats.length,
          available_seats: available.length,
          min_price: prices.length > 0 ? prices[0] : null,
          max_price: prices.length > 0 ? prices[prices.length - 1] : null,
          median_price: medianPrice,
          categories,
          last_scan_at: new Date().toISOString(),
          scan_count: scanCount || 0,
          unique_scanners: uniqueScanners || 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "performance_id" }
      );

      if (summaryError) {
        console.error("match_summary upsert error:", summaryError);
      }

      // 4. Hourly snapshot for trends
      const now = new Date();
      const hourStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()).toISOString();

      const { data: existing } = await supabase
        .from("match_summary_history")
        .select("id")
        .eq("performance_id", performanceId)
        .eq("hour", hourStart)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update existing hourly row with latest stats
        await supabase
          .from("match_summary_history")
          .update({
            total_seats: seatStats.length,
            available_seats: available.length,
            min_price: prices.length > 0 ? prices[0] : null,
            max_price: prices.length > 0 ? prices[prices.length - 1] : null,
            median_price: medianPrice,
          })
          .eq("id", existing[0].id);
      } else {
        // Insert new hourly row
        await supabase.from("match_summary_history").insert({
          performance_id: performanceId,
          total_seats: seatStats.length,
          available_seats: available.length,
          min_price: prices.length > 0 ? prices[0] : null,
          max_price: prices.length > 0 ? prices[prices.length - 1] : null,
          median_price: medianPrice,
          hour: hourStart,
        });
      }
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("ingest-scan error:", err);
    return jsonResponse({ ok: true });
  }
});
