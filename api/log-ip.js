export default async function handler(req, res) {
  // CORS headers so SW can fetch
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end(); // preflight
  // Parse request body safely
  let body = {};
  try {
    body = await new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(JSON.parse(data)));
    });
  } catch (err) {
    return res.status(400).json({ error: "Invalid JSON" });
  }
  const { visitorId, platform, screenW, screenH, timezone } = body;
  // Get IP and User-Agent
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  // Prepare payload
  const payload = {
    visitor_id: visitorId,
    ip,
    user_agent: ua,
    platform: platform || "unknown",
    screen_w: screenW || null,
    screen_h: screenH || null,
    timezone: timezone || "unknown",
    last_seen: new Date().toISOString(),
  };
  // Send to Supabase REST API
  let supabaseResponse, supabaseText;
  try {
    supabaseResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/visitors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(payload),
    });
    supabaseText = await supabaseResponse.text();
  } catch (err) {
    return res.status(500).json({ error: "Fetch failed", details: err.toString() });
  }
  // Return debug info
  res.status(200).json({
    ok: supabaseResponse.ok,
    status: supabaseResponse.status,
    statusText: supabaseResponse.statusText,
    supabaseText,
  });
}
