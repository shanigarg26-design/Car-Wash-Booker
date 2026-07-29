/**
 * Location Service – Router
 * Reverse geocoding and address search via OpenStreetMap Nominatim.
 * Also provides IP-based location lookup for auto-detecting the user's city.
 *
 * No auth required — data is publicly available.
 */
import { Router, Request, Response, NextFunction } from "express";

const router = Router();

function openCors(_req: Request, res: Response, next: NextFunction) {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
}
router.use("/geocode", openCors);

router.get("/geocode/search", async (req, res) => {
  const q = req.query.q as string;
  if (!q?.trim()) return res.json([]);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=10&addressdetails=1&accept-language=en`;
    const data = await (await fetch(url, { headers: { "User-Agent": "CarCleanProApp/1.0", "Referer": "https://carcleanpro.app" } })).json();
    res.json(data);
  } catch { res.json([]); }
});

router.get("/geocode/reverse", async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) return res.json({});
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=en`;
    const data = await (await fetch(url, { headers: { "User-Agent": "CarCleanProApp/1.0", "Referer": "https://carcleanpro.app" } })).json();
    res.json(data);
  } catch { res.json({}); }
});

router.get("/geocode/ip-location", async (req, res) => {
  const forwarded = req.headers["x-forwarded-for"];
  const rawIp     = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?? (req.headers["x-real-ip"] as string)
    ?? req.socket?.remoteAddress ?? "";
  const clientIp = rawIp.split(",")[0].trim().replace(/^::ffff:/, "");

  try {
    const target = clientIp && clientIp !== "127.0.0.1" && clientIp !== "::1" ? clientIp : "";
    const data   = await (await fetch(`http://ip-api.com/json/${target}?fields=status,lat,lon,city,regionName,country`, { signal: AbortSignal.timeout(6000) })).json();
    if (data.status === "success" && data.lat && data.lon) {
      return res.json({
        latitude:  data.lat, longitude: data.lon,
        address:   [data.city, data.regionName, data.country].filter(Boolean).join(", "),
      });
    }
  } catch { /* timeout / network error */ }

  res.status(422).json({ error: "ip_lookup_failed" });
});

export default router;
