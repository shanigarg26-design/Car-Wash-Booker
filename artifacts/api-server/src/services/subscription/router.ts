/**
 * Subscription / Packages Service – Router
 * Sells prepaid car-wash packages (with a tiered discount that grows with the
 * duration) and tracks a customer's active package.
 */
import { Router, type IRouter } from "express";
import { db, subscriptionsTable, usersTable, bookingsTable, cleanersTable } from "@workspace/db";
import { eq, and, gt, inArray } from "drizzle-orm";
import { PACKAGES, priceForPackage } from "../booking/service.js";
import { sendPush } from "../../shared/push.js";

/** Append one make-up wash-day to a daily package and bump its end date + total. */
async function extendPackageByOneDay(pkg: typeof subscriptionsTable.$inferSelect): Promise<Date> {
  const nextDay = new Date(pkg.expiresAt.getTime() + 86_400_000);
  await db.insert(bookingsTable).values({
    customerId: pkg.customerId,
    cleanerId: null,
    customerAddress: pkg.address ?? "",
    customerLat: pkg.latitude != null ? Number(pkg.latitude) : null,
    customerLng: pkg.longitude != null ? Number(pkg.longitude) : null,
    scheduledAt: nextDay,
    status: "scheduled",
    vehicleType: pkg.vehicleType || null,
    cleanType: pkg.cleanType,
    priceQuoted: pkg.pricePerWash ?? 0,
    subscriptionId: pkg.id,
  });
  await db.update(subscriptionsTable)
    .set({ expiresAt: nextDay, washesTotal: pkg.washesTotal + 1 })
    .where(eq(subscriptionsTable.id, pkg.id));
  return nextDay;
}

async function pushToUser(userId: number, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  const [u] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, userId));
  if (u?.token) await sendPush([u.token], title, body, data);
}

const router: IRouter = Router();

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * UTC Date for "IST midnight of (today + dayOffset) + minutes". Used to lay out a
 * daily package's wash times: same wall-clock time in India every day.
 */
export function istDailyToUtc(dayOffset: number, minutes: number, from: Date = new Date()): Date {
  const ist = new Date(from.getTime() + IST_OFFSET_MS);
  const istMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  const targetIstMs = istMidnight + dayOffset * 86_400_000 + minutes * 60_000;
  return new Date(targetIstMs - IST_OFFSET_MS);
}

// GET /api/packages?vehicleType=&washType=  — the 5 plans priced for this vehicle+clean.
router.get("/packages", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const vehicleType = (req.query.vehicleType as string) || null;
  const cleanType   = (req.query.washType as string) || (req.query.cleanType as string) || "exterior";
  res.json({
    vehicleType, cleanType,
    packages: PACKAGES.map(p => priceForPackage(p, vehicleType, cleanType)),
  });
});

/** Attach the day-by-day schedule + the bound washer/customer names to a package. */
async function enrichPackage(s: typeof subscriptionsTable.$inferSelect) {
  const base = {
    ...s,
    washesRemaining: s.washesTotal - s.washesUsed,
    startedAt: s.startedAt.toISOString(), expiresAt: s.expiresAt.toISOString(), createdAt: s.createdAt.toISOString(),
  };
  if (s.kind !== "daily") return base;

  const days = await db.select({
    id: bookingsTable.id, scheduledAt: bookingsTable.scheduledAt, status: bookingsTable.status,
    notes: bookingsTable.notes, otpShared: bookingsTable.otpShared,
  }).from(bookingsTable).where(eq(bookingsTable.subscriptionId, s.id));
  days.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  let cleanerName: string | null = null;
  if (s.cleanerId) {
    const [c] = await db.select({ name: usersTable.name }).from(cleanersTable)
      .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id)).where(eq(cleanersTable.id, s.cleanerId));
    cleanerName = c?.name ?? null;
  }
  const [cust] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, s.customerId));

  return {
    ...base,
    cleanerName, customerName: cust?.name ?? null,
    daysCompleted: days.filter(d => d.status === "completed").length,
    days: days.map(d => ({ ...d, scheduledAt: d.scheduledAt.toISOString() })),
  };
}

// GET /api/subscriptions/mine — the customer's active packages (with daily schedule).
router.get("/subscriptions/mine", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.customerId, userId), eq(subscriptionsTable.status, "active"), gt(subscriptionsTable.expiresAt, new Date())));
  res.json(await Promise.all(subs.map(enrichPackage)));
});

// GET /api/subscriptions/serving — daily packages the logged-in washer is bound to.
router.get("/subscriptions/serving", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.json([]); return; }

  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.cleanerId, cleaner.id), eq(subscriptionsTable.status, "active"), gt(subscriptionsTable.expiresAt, new Date())));
  res.json(await Promise.all(subs.map(enrichPackage)));
});

// POST /api/subscriptions  { packageKey, vehicleType, washType }  — buy a package.
router.post("/subscriptions", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { packageKey, vehicleType, washType, cleanType } = req.body as { packageKey?: string; vehicleType?: string; washType?: string; cleanType?: string };
  const pkg = PACKAGES.find(p => p.key === packageKey);
  if (!pkg) { res.status(400).json({ error: "invalid_package", message: "Unknown package." }); return; }
  const finalClean = washType ?? cleanType ?? "exterior";

  const pricing = priceForPackage(pkg, vehicleType ?? null, finalClean);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);

  const [sub] = await db.insert(subscriptionsTable).values({
    customerId: userId, packageKey: pkg.key, vehicleType: vehicleType ?? "", cleanType: finalClean,
    washesTotal: pkg.washes, washesUsed: 0, discountPercent: pkg.discountPercent,
    pricePaid: pricing.packagePrice, startedAt: now, expiresAt, status: "active",
  }).returning();

  res.status(201).json({
    ...sub, washesRemaining: sub.washesTotal, savings: pricing.savings, label: pkg.label,
    startedAt: sub.startedAt.toISOString(), expiresAt: sub.expiresAt.toISOString(), createdAt: sub.createdAt.toISOString(),
  });
});

// POST /api/subscriptions/daily — start a POSTPAID daily package.
// One wash per day at a fixed IST time for `durationDays`; the same washer serves
// every day (bound when the first day's booking is accepted). Billed weekly, offline.
router.post("/subscriptions/daily", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const b = req.body as Record<string, unknown>;
  const finalClean = (b.washType as string) ?? (b.cleanType as string) ?? "exterior";
  const dailyMinutes = Number(b.dailyMinutes);
  const durationDays = Number(b.durationDays);
  const address = (b.address as string) ?? "";
  const lat = b.latitude, lng = b.longitude;

  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes >= 1440) {
    res.status(400).json({ error: "invalid_time", message: "Pick a valid daily time." }); return;
  }
  if (![7, 30].includes(durationDays)) {
    res.status(400).json({ error: "invalid_duration", message: "Choose a weekly or monthly plan." }); return;
  }
  if (!address || lat == null || lng == null) {
    res.status(400).json({ error: "no_location", message: "A service address is required." }); return;
  }

  // Optional: owner requests a specific washer (e.g. re-book a previous one).
  let preferredCleanerId: number | null = null;
  let preferredRate: number | null = null;
  if (b.preferredCleanerId != null) {
    const [c] = await db.select().from(cleanersTable).where(eq(cleanersTable.id, Number(b.preferredCleanerId)));
    if (!c) { res.status(400).json({ error: "unknown_washer", message: "That washer is unavailable." }); return; }
    preferredCleanerId = c.id;
    preferredRate = c.pricePerClean;
  }

  const now = new Date();
  // First wash = next occurrence of the daily time in IST (today if still ahead, else tomorrow).
  const startOffset = istDailyToUtc(0, dailyMinutes, now).getTime() > now.getTime() ? 0 : 1;
  const firstDay = istDailyToUtc(startOffset, dailyMinutes, now);
  const lastDay  = istDailyToUtc(startOffset + durationDays - 1, dailyMinutes, now);

  const [sub] = await db.insert(subscriptionsTable).values({
    customerId: userId,
    packageKey: durationDays === 7 ? "daily-weekly" : "daily-monthly",
    vehicleType: (b.vehicleType as string) ?? "", cleanType: finalClean,
    washesTotal: durationDays, washesUsed: 0, discountPercent: 0, pricePaid: 0,
    startedAt: firstDay, expiresAt: lastDay, status: "active",
    kind: "daily", cleanerId: null, preferredCleanerId,
    dailyMinutes, pricePerWash: preferredRate,
    address, latitude: String(lat), longitude: String(lng),
  }).returning();

  // Lay out one 'scheduled' booking per day, linked to the package. cleanerId stays
  // null until the package is assigned (first accept) — the promotion sweep dispatches
  // day-1 and binds the washer, then assigns his remaining days automatically.
  const rows = Array.from({ length: durationDays }, (_, d) => ({
    customerId: userId,
    cleanerId: null,
    customerAddress: address,
    customerLat: Number(lat), customerLng: Number(lng),
    scheduledAt: istDailyToUtc(startOffset + d, dailyMinutes, now),
    status: "scheduled",
    vehicleType: (b.vehicleType as string) ?? null, cleanType: finalClean,
    priceQuoted: preferredRate ?? 0,
    subscriptionId: sub.id,
  }));
  await db.insert(bookingsTable).values(rows);

  res.status(201).json({
    ...sub,
    washesRemaining: sub.washesTotal,
    startedAt: sub.startedAt.toISOString(), expiresAt: sub.expiresAt.toISOString(), createdAt: sub.createdAt.toISOString(),
  });
});

// PATCH /api/subscriptions/:id/cancel — cancel the whole package. Either the owner
// OR the bound washer may cancel, any time. Remaining days are dropped (washer freed).
router.patch("/subscriptions/:id/cancel", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  const isCustomer = sub.customerId === userId;
  const isWasher   = cleaner != null && sub.cleanerId === cleaner.id;
  if (!isCustomer && !isWasher) { res.status(403).json({ error: "Not your package" }); return; }

  await db.update(subscriptionsTable).set({ status: "cancelled" }).where(eq(subscriptionsTable.id, id));
  // Drop every not-yet-done day so the washer is freed and nothing else dispatches.
  await db.update(bookingsTable).set({ status: "cancelled", cleanerId: null })
    .where(and(eq(bookingsTable.subscriptionId, id), inArray(bookingsTable.status, ["scheduled", "accepted", "arrived"])));

  // Tell the other side.
  if (isCustomer && sub.cleanerId) {
    const [c] = await db.select({ uid: cleanersTable.userId }).from(cleanersTable).where(eq(cleanersTable.id, sub.cleanerId));
    if (c) await pushToUser(c.uid, "Package cancelled", "A daily package you served was cancelled by the customer.", { type: "package_cancelled", subscriptionId: id });
  } else if (isWasher) {
    await pushToUser(sub.customerId, "Package cancelled", "Your washer cancelled the daily package. You can start a new one anytime.", { type: "package_cancelled", subscriptionId: id });
  }
  res.json({ ok: true });
});

// PATCH /api/subscriptions/:id/skip-day  { bookingId, reason? }
// Cancel ONE day of a daily package (owner or washer, unlimited) — or the owner marks
// a no-show (reason: "no_show"). The dropped day doesn't count; the package auto-extends
// by one make-up day at the end. Owner-cancel frees the washer for that day.
router.patch("/subscriptions/:id/skip-day", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  const bookingId = Number((req.body as Record<string, unknown>).bookingId);
  const reasonIn = String((req.body as Record<string, unknown>).reason ?? "");
  if (isNaN(id) || !Number.isInteger(bookingId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub || sub.kind !== "daily") { res.status(404).json({ error: "Package not found" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  const isCustomer = sub.customerId === userId;
  const isWasher   = cleaner != null && sub.cleanerId === cleaner.id;
  if (!isCustomer && !isWasher) { res.status(403).json({ error: "Not your package" }); return; }

  const [day] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.subscriptionId, id)));
  if (!day) { res.status(404).json({ error: "Day not found" }); return; }
  if (["completed", "cancelled"].includes(day.status)) {
    res.status(409).json({ error: "day_closed", message: "That day is already finished." }); return;
  }
  // no-show is an owner action against an assigned-but-not-done day.
  const reason = reasonIn === "no_show" && isCustomer ? "no_show"
    : isCustomer ? "owner_cancelled" : "washer_cancelled";

  await db.update(bookingsTable).set({ status: "cancelled", cleanerId: null, notes: reason })
    .where(eq(bookingsTable.id, bookingId));
  const newEnd = await extendPackageByOneDay(sub);

  // Notify the other party.
  const when = day.scheduledAt.toLocaleString("en-IN", { day: "numeric", month: "short" });
  if (isCustomer && sub.cleanerId) {
    const [c] = await db.select({ uid: cleanersTable.userId }).from(cleanersTable).where(eq(cleanersTable.id, sub.cleanerId));
    if (c) await pushToUser(c.uid, reason === "no_show" ? "Marked absent" : "Day cancelled",
      `${when}'s wash was ${reason === "no_show" ? "marked as a no-show" : "cancelled by the customer"}. The package was extended by a day.`,
      { type: "package_day_skipped", subscriptionId: id });
  } else if (isWasher) {
    await pushToUser(sub.customerId, "Washer skipped a day", `${when}'s wash was cancelled by your washer. The package was extended by a day.`, { type: "package_day_skipped", subscriptionId: id });
  }

  res.json({ ok: true, extendedTo: newEnd.toISOString() });
});

/**
 * Finds an active package that covers a given vehicle+clean (washes remaining, not
 * expired) for a customer. Used by booking creation to auto-cover a wash.
 */
export async function findCoveringSubscription(customerId: number, vehicleType: string | null, cleanType: string) {
  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.customerId, customerId), eq(subscriptionsTable.status, "active"), gt(subscriptionsTable.expiresAt, new Date())));
  // Only legacy prepaid buckets auto-cover an ad-hoc wash; daily packages are their
  // own scheduled days and are billed weekly, so they must not absorb one-off bookings.
  return subs.find(s => s.kind !== "daily" && s.washesUsed < s.washesTotal && s.cleanType === cleanType && (!s.vehicleType || s.vehicleType === (vehicleType ?? ""))) ?? null;
}

export default router;
