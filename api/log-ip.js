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
  try {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: null,
        embeds: [
          {
            title: `🌍 ${body.isNew ? "New" : "Returning"} TVP Visitor Logged`,
            color: 5814783,
            fields: [
              { name: "Visitor ID", value: body.visitorId || "unknown", inline: false },
              { name: "User Agent", value: req.headers.get("user-agent") || "unknown", inline: false },
              { name: "IP Address", value: ip, inline: true },
              { name: "Platform", value: body.platform || "unknown", inline: true },
              { name: "Screen Size", value: `${body.screenW} x ${body.screenH}`, inline: true },
              { name: "Screen Touch", value: body.touchScreen ? "Yes" : "No", inline: true },
              { name: "Last Visit", value: body.lastVisited || "unknown", inline: true },
              { name: "Total Visits", value: body.visitCount || "unknown", inline: true },
              { name: "Timezone", value: body.timezone || "unknown", inline: false },
              { name: "Geo Location", value: `Country: ${geo.country || "unknown"}\nCity: ${geo.city || "unknown"}\nRegion: ${geo.region || "unknown"}`, inline: false },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to send to Discord", details: err.toString() }), { status: 500, headers });
  }
  return new Response(JSON.stringify({ ok: true, logged: true }), { status: 200, headers });
}
