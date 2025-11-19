import { createClient } from "@supabase/supabase-js";

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
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase.from("visitors").upsert({
    visitor_id: body.visitorId,
    ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket?.remoteAddress || "unknown",
    user_agent: req.headers["user-agent"] || "unknown",
    platform: body.platform || "unknown",
    screen_w: body.screenW || null,
    screen_h: body.screenH || null,
    timezone: body.timezone || "unknown",
    last_seen: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ ok: true, data });
}
