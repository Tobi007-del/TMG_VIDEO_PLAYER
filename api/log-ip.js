export const config = { runtime: "edge" };

export default async function handler(req) {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const body = await req.json(),
    ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    { SUPABASE_SECRET_KEY: sbKey, SUPABASE_URL: sbUrl, DISCORD_WEBHOOK_URL: dcUrl } = process.env;

  let geo = req.geo || {};
  if (!geo.country)
    try {
      const data = await (await fetch(`https://ipapi.co/${ip}/json/`)).json();
      geo = { country: data.country_name, city: data.city, region: data.region };
    } catch {}

  const payload = { visitor_id: body.visitorId, is_new: body.isNew, visit_count: body.visitCount ?? 1, ip, country: geo.country, city: geo.city, region: geo.region, platform: body.platform, screen_size: body.screenW && body.screenH ? `${body.screenW} x ${body.screenH}` : undefined, touch_screen: !!body.touchScreen, timezone: body.timezone, last_visited: body.lastVisited, user_agent: req.headers.get("user-agent") || undefined };
  console.log(`[VISITOR] ${body.isNew ? "✨ New" : "🔄 Returning"} #${payload.visit_count} | IP (${ip}) | ${payload.city ?? "Unknown City"}, ${payload.country ?? "Unknown Country"}`);

  try {
    const tasks = [];

    if (sbUrl && sbKey)
      tasks.push(
        fetch(body.isNew ? `${sbUrl}/rest/v1/visitors?on_conflict=visitor_id` : `${sbUrl}/rest/v1/visitors?visitor_id=eq.${payload.visitor_id}`, {
          method: body.isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json", apikey: sbKey, Authorization: `Bearer ${sbKey}`, Prefer: body.isNew ? "resolution=merge-duplicates" : "return=minimal" },
          body: JSON.stringify(payload),
        })
          .then((r) => console.log(`[SUPABASE] ${r.ok ? "Success" : "Failed"}: ${r.status}`))
          .catch((e) => console.error(`[SUPABASE] Error:`, e.message || e))
      );

    if (dcUrl && body.isNew)
      tasks.push(
        fetch(dcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [
              {
                title: "🌍 New TVP Visitor Logged",
                color: 5814783,
                fields: [
                  { name: "Visitor ID", value: payload.visitor_id || "N/A" },
                  { name: "User Agent", value: payload.user_agent || "N/A" },
                  { name: "IP Address", value: ip, inline: true },
                  { name: "Platform", value: payload.platform || "N/A", inline: true },
                  { name: "Screen Size", value: payload.screen_size || "N/A", inline: true },
                  { name: "Screen Touch", value: payload.touch_screen ? "Yes" : "No", inline: true },
                  { name: "Timezone", value: payload.timezone || "N/A" },
                  { name: "Geo Location", value: `Country: ${payload.country || "N/A"}\nCity: ${payload.city || "N/A"}\nRegion: ${payload.region || "N/A"}` },
                ],
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        })
          .then((r) => console.log(`[DISCORD] ${r.ok ? "Success" : "Failed"}: ${r.status}`))
          .catch((e) => console.error(`[DISCORD] Error:`, e.message || e))
      );

    if (tasks.length) await Promise.all(tasks);
    return new Response(JSON.stringify({ ok: true, logged: true, ip, geo }), { status: 200, headers });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to log visitor", details: err.toString() }), { status: 500, headers });
  }
}
