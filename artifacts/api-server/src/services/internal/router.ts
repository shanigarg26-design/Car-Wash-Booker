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
import { db, subscriptionsTable, bookingsTable, packageBillsTable, cleanersTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";

const router: IRouter = Router();

/** All /internal routes share the SWEEP_TOKEN secret (header x-sweep-token). */
function authed(req: { header: (h: string) => string | undefined }): boolean {
  const expected = process.env.SWEEP_TOKEN;
  const provided = req.header("x-sweep-token");
  return !!expected && provided === expected;
}

router.post("/internal/sweep", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  try {
    const result = await sweepStaleBookings();
    const billing = await runPackageBillingSweep();
    res.json({ ok: true, ...result, billing });
  } catch (err) {
    console.error("[Sweep] error:", err);
    res.status(500).json({ error: "sweep_failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST TOOLING (token-gated). Lets you exercise the time-based package/billing
// flows in seconds instead of waiting real days. Not used by the app itself.
// ─────────────────────────────────────────────────────────────────────────────

// GET /internal/test/packages — recent daily packages, newest first.
router.get("/internal/test/packages", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const rows = await db.select({
    id: subscriptionsTable.id, customerId: subscriptionsTable.customerId,
    status: subscriptionsTable.status, cleanerId: subscriptionsTable.cleanerId,
    preferredCleanerId: subscriptionsTable.preferredCleanerId,
    dailyMinutes: subscriptionsTable.dailyMinutes, pricePerWash: subscriptionsTable.pricePerWash,
    washesTotal: subscriptionsTable.washesTotal, washesUsed: subscriptionsTable.washesUsed,
    startedAt: subscriptionsTable.startedAt, expiresAt: subscriptionsTable.expiresAt,
  }).from(subscriptionsTable).where(eq(subscriptionsTable.kind, "daily"))
    .orderBy(desc(subscriptionsTable.id)).limit(20);
  res.json(rows);
});

// GET /internal/test/cleaners — washers (id, name, online flags, slots) for test setup.
router.get("/internal/test/cleaners", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const rows = await db.select({
    id: cleanersTable.id, userId: cleanersTable.userId,
    available: cleanersTable.available, pricePerClean: cleanersTable.pricePerClean,
    availableSlots: cleanersTable.availableSlots,
  }).from(cleanersTable).orderBy(desc(cleanersTable.id)).limit(20);
  res.json(rows);
});

// GET /internal/test/package/:id — full state: package + every day + every bill.
router.get("/internal/test/package/:id", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!pkg) { res.status(404).json({ error: "not_found" }); return; }
  const days = await db.select().from(bookingsTable).where(eq(bookingsTable.subscriptionId, id));
  const bills = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, id));
  days.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  bills.sort((a, b) => a.weekIndex - b.weekIndex);
  res.json({
    package: pkg,
    days: days.map(d => ({ id: d.id, scheduledAt: d.scheduledAt, status: d.status, cleanerId: d.cleanerId, notes: d.notes, completedAt: d.completedAt })),
    bills,
  });
});

// POST /internal/test/package/:id/shift { days } — TIME TRAVEL: move the whole package
// (start/end + every day's scheduled/completed time + every bill's dates) back N days,
// so the next sweep behaves as if N days have passed (bills weeks, hits grace, expires…).
router.post("/internal/test/package/:id/shift", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  const days = Number((req.body as Record<string, unknown>)?.days ?? 0);
  if (!Number.isFinite(days)) { res.status(400).json({ error: "bad_days" }); return; }
  const ms = days * 86_400_000;
  const back = (d: Date | null) => (d ? new Date(d.getTime() - ms) : d);

  const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!pkg) { res.status(404).json({ error: "not_found" }); return; }

  await db.update(subscriptionsTable)
    .set({ startedAt: back(pkg.startedAt)!, expiresAt: back(pkg.expiresAt)! })
    .where(eq(subscriptionsTable.id, id));
  const dayRows = await db.select().from(bookingsTable).where(eq(bookingsTable.subscriptionId, id));
  for (const d of dayRows) {
    await db.update(bookingsTable).set({ scheduledAt: back(d.scheduledAt)!, completedAt: back(d.completedAt) }).where(eq(bookingsTable.id, d.id));
  }
  const billRows = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, id));
  for (const b of billRows) {
    await db.update(packageBillsTable).set({ weekStart: back(b.weekStart)!, weekEnd: back(b.weekEnd)!, dueDate: back(b.dueDate)!, createdAt: back(b.createdAt)! }).where(eq(packageBillsTable.id, b.id));
  }
  res.json({ ok: true, shiftedBackDays: days, days: dayRows.length, bills: billRows.length });
});

// POST /internal/test/package/:id/bind { cleanerId } — bind a washer without the accept
// flow (sets pricePerWash from his rate, stamps him on all remaining days).
router.post("/internal/test/package/:id/bind", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  const cleanerId = Number((req.body as Record<string, unknown>)?.cleanerId);
  const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.id, cleanerId));
  if (!pkg || !cleaner) { res.status(404).json({ error: "not_found" }); return; }
  await db.update(subscriptionsTable)
    .set({ cleanerId, preferredCleanerId: cleanerId, pricePerWash: cleaner.pricePerClean, status: "active" })
    .where(eq(subscriptionsTable.id, id));
  await db.update(bookingsTable).set({ cleanerId, priceQuoted: cleaner.pricePerClean })
    .where(and(eq(bookingsTable.subscriptionId, id), eq(bookingsTable.status, "scheduled")));
  res.json({ ok: true, boundTo: cleanerId, rate: cleaner.pricePerClean });
});

// POST /internal/test/package/:id/complete-days { count } — mark the earliest N open days
// 'completed' (completedAt = their scheduled time), to simulate washes done for billing.
router.post("/internal/test/package/:id/complete-days", async (req, res): Promise<void> => {
  if (!authed(req)) { res.status(401).json({ error: "unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  const count = Math.max(1, Number((req.body as Record<string, unknown>)?.count ?? 1));
  const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!pkg) { res.status(404).json({ error: "not_found" }); return; }
  const open = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.subscriptionId, id), inArray(bookingsTable.status, ["scheduled", "accepted", "arrived", "in_progress"])));
  open.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  let n = 0;
  for (const d of open) {
    if (n >= count) break;
    await db.update(bookingsTable)
      .set({ status: "completed", completedAt: d.scheduledAt, cleanerId: d.cleanerId ?? pkg.cleanerId, amountCharged: 0 })
      .where(eq(bookingsTable.id, d.id));
    n++;
  }
  await db.update(subscriptionsTable).set({ washesUsed: pkg.washesUsed + n }).where(eq(subscriptionsTable.id, id));
  res.json({ ok: true, completed: n });
});

export default router;
