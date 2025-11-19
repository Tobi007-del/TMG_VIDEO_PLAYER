export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end(); // CORS preflight
  let body = {};
  try {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => resolve(JSON.parse(data)));
      req.on("error", (err) => reject(err));
    });
  } catch (e) {
    return res.status(400).json({ error: `Invalid JSON: ${e}` });
  }
  console.log("Supabase URL:", process.env.SUPABASE_URL);
  console.log("Service Key:", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
  let supabaseResponse, supabaseText; // Send to Supabase REST API
  try {
    supabaseResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/visitors`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        visitor_id: body.visitorId,
        ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown",
        user_agent: req.headers["user-agent"] || "unknown",
        platform: body.platform || "unknown",
        screen_w: body.screenW || null,
        screen_h: body.screenH || null,
        timezone: body.timezone || "unknown",
        last_seen: new Date().toISOString(),
      }),
    });
    supabaseText = await supabaseResponse.text();
  } catch (err) {
    return res.status(500).json({ error: "Fetch failed", details: err.toString() });
  }
  res.status(200).json({
    ok: supabaseResponse.ok,
    status: supabaseResponse.status,
    statusText: supabaseResponse.statusText,
    supabaseText,
  }); // Return debug info
}
