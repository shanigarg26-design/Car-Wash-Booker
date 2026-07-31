/**
 * Internal Service – Router
 * Endpoints meant to be called by trusted schedulers (e.g. a GitHub Actions cron),
 * NOT by end users. Guarded by a shared secret in the `x-sweep-token` header that
 * matches the SWEEP_TOKEN env var. This keeps the self-healing sweep running even
 * though Render's free tier sleeps and drops in-process timers.
 */
import { Router, type IRouter } from "express";
import { sweepStaleBookings } from "../booking/dispatcher.js";
import { runPackageBillingSweep } from "../subscription/billing.js";

const router: IRouter = Router();

router.post("/internal/sweep", async (req, res): Promise<void> => {
  const expected = process.env.SWEEP_TOKEN;
  const provided = req.header("x-sweep-token");
  if (!expected || provided !== expected) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  try {
    const result = await sweepStaleBookings();
    const billing = await runPackageBillingSweep();
    res.json({ ok: true, ...result, billing });
  } catch (err) {
    console.error("[Sweep] error:", err);
    res.status(500).json({ error: "sweep_failed" });
  }
});

export default router;
