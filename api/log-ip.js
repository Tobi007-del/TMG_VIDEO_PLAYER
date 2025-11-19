export default async function handler(req, res) {
  // Allow your origin so SW fetch works
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Handle preflight
  if (req.method === "OPTIONS") return res.status(204).end();
  const body = await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(JSON.parse(data)));
  });
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  const { visitorId, platform, screenW, screenH, timezone } = body;
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/visitors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      visitor_id: visitorId,
      ip,
      user_agent: ua,
      platform: platform || "unknown",
      screen_w: screenW || null,
      screen_h: screenH || null,
      timezone: timezone || "unknown",
      last_seen: new Date().toISOString(),
    }),
  });
  res.status(200).json({ ok: true });
}
