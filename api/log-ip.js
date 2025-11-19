export const config = { runtime: "edge" };

export default async function handler(req) {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  const body = await req.json(),
    ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    geo = req.geo || {},
    userAgent = req.headers.get("user-agent") || "unknown";
  try {
    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: null,
        embeds: [
          {
            title: "🌍 New TVP Visitor Logged",
            color: 5814783,
            fields: [
              { name: "Visitor ID", value: body.visitorId || "unknown", inline: false },
              { name: "IP Address", value: ip, inline: false },
              { name: "User Agent", value: userAgent, inline: false },
              { name: "Platform", value: body.platform || "unknown", inline: true },
              { name: "Screen", value: `${body.screenW} x ${body.screenH}`, inline: true },
              { name: "Timezone", value: body.timezone || "unknown", inline: false },
              { name: "Geo Location", value: `Country: ${geo.country || "N/A"}\nCity: ${geo.city || "N/A"}\nRegion: ${geo.region || "N/A"}`, inline: false },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to send to Discord", details: err.toString() }), { status: 500, headers });
  }
  return new Response(JSON.stringify({ ok: true, logged: true, ip, geo }), { status: 200, headers });
}
