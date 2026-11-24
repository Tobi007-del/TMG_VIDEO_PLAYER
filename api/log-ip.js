export const config = { runtime: "edge" };

export default async function handler(req) {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const body = await req.json(),
    ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  let geo = req.geo || {};
  if (!geo.country) {
    try {
      const data = await (await fetch(`https://ipapi.co/${ip}/json/`)).json();
      geo = { country: data.country_name, city: data.city, region: data.region };
    } catch {}
  }

  const payload = { visitor_id: body.visitorId || "unknown", is_new: !!body.isNew, visit_count: body.visitCount || 1, ip, country: geo.country || "unknown", city: geo.city || "unknown", region: geo.region || "unknown", platform: body.platform || "unknown", screen_size: `${body.screenW} x ${body.screenH}`, touch_screen: !!body.touchScreen, timezone: body.timezone || "unknown", last_visited: body.lastVisited || "unknown", user_agent: req.headers.get("user-agent") || "unknown" };

  console.log(`[VISITOR] ${body.isNew ? "✨ New" : "🔄 Returning"} #${body.visitCount || 1} | IP (${ip}) | ${geo.city || "Unknown City"}, ${geo.country || "Unknown Country"}`);

  try {
    const tasks = [],
      supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

    if (process.env.SUPABASE_URL && supabaseKey)
      tasks.push(
        fetch(`${process.env.SUPABASE_URL}/rest/v1/visitors?on_conflict=visitor_id`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(payload),
        })
          .then(async (res) => (res.ok ? console.log(`[SUPABASE] Success (${res.status})`) : console.error(`[SUPABASE] Failed (${res.status}):`, await res.text())))
          .catch((err) => console.error(`[SUPABASE] Network Error:`, err.message || err))
      );

    if (process.env.DISCORD_WEBHOOK_URL && body.isNew)
      tasks.push(
        fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: null,
            embeds: [
              {
                title: `🌍 New TVP Visitor Logged`,
                color: 5814783,
                fields: [
                  { name: "Visitor ID", value: body.visitorId || "unknown", inline: false },
                  { name: "User Agent", value: req.headers.get("user-agent") || "unknown", inline: false },
                  { name: "IP Address", value: ip, inline: true },
                  { name: "Platform", value: body.platform || "unknown", inline: true },
                  { name: "Screen Size", value: `${body.screenW} x ${body.screenH}`, inline: true },
                  { name: "Screen Touch", value: body.touchScreen ? "Yes" : "No", inline: true },
                  // { name: "Last Visit", value: body.lastVisited || "unknown", inline: true },
                  // { name: "Total Visits", value: body.visitCount || "unknown", inline: true },
                  { name: "Timezone", value: body.timezone || "unknown", inline: false },
                  { name: "Geo Location", value: `Country: ${geo.country || "unknown"}\nCity: ${geo.city || "unknown"}\nRegion: ${geo.region || "unknown"}`, inline: false },
                ],
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        })
          .then(async (res) => (res.ok ? console.log(`[DISCORD] Success (${res.status})`) : console.error(`[DISCORD] Failed (${res.status}):`, await res.text())))
          .catch((err) => console.error(`[DISCORD] Network Error:`, err.message || err))
      );

    if (tasks.length) await Promise.all(tasks);
    return new Response(JSON.stringify({ ok: true, logged: true, ip, geo }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to log visitor", details: err.toString() }), { status: 500, headers });
  }
}
