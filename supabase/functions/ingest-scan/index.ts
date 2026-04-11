import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();
    const { visitorId, licenseHash, performanceId, match, seats } = body;

    // Validate
    if (!performanceId || !seats || typeof seats !== "object") {
      return new Response(JSON.stringify({ ok: false, error: "Invalid payload" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!visitorId) {
      return new Response(JSON.stringify({ ok: false, error: "Missing visitorId" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const seatEntries = Object.entries(seats);
    if (seatEntries.length === 0 || seatEntries.length > 15000) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid seat count" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
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

    // 2. Upsert seats (latest state)
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
      last_seen_at: new Date().toISOString(),
    }));

    // Upsert in chunks of 500
    for (let i = 0; i < seatRows.length; i += 500) {
      const chunk = seatRows.slice(i, i + 500);
      const { error: seatError } = await supabase
        .from("seats")
        .upsert(chunk, { onConflict: "performance_id,seat_id", ignoreDuplicates: false });

      if (seatError) {
        console.error(`seats upsert error (chunk ${i}):`, seatError);
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

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ingest-scan error:", err);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
