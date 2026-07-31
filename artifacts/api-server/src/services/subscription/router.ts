/**
 * Subscription / Packages Service – Router
 * Sells prepaid car-wash packages (with a tiered discount that grows with the
 * duration) and tracks a customer's active package.
 */
import { Router, type IRouter } from "express";
import { db, subscriptionsTable, usersTable, bookingsTable, cleanersTable, packageBillsTable } from "@workspace/db";
import { eq, and, gt, gte, inArray } from "drizzle-orm";
import { PACKAGES, priceForPackage } from "../booking/service.js";
import { sendPush } from "../../shared/push.js";

/** Append one make-up wash-day to a daily package and bump its end date + total. */
async function extendPackageByOneDay(pkg: typeof subscriptionsTable.$inferSelect): Promise<Date> {
  const nextDay = new Date(pkg.expiresAt.getTime() + 86_400_000);
  await db.insert(bookingsTable).values({
    customerId: pkg.customerId,
    cleanerId: pkg.cleanerId ?? null, // keep make-up days owned by the bound washer

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

const ALL_SLOTS = Array.from({ length: 24 }, (_, i) => i); // 06:00–17:30 IST, half-hourly

/** Half-hour slot index (0..23) for a UTC instant in IST, or -1 outside 06:00–18:00. */
function dateToIstSlot(d: Date): number {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  if (h < 6 || h >= 18) return -1;
  return (h - 6) * 2 + (m >= 30 ? 1 : 0);
}
/** Slot index for a daily-minutes value (e.g. 540 = 09:00 → slot 6), or -1 if out of range. */
function minutesToSlot(minutes: number): number {
  if (minutes < 360 || minutes >= 1080) return -1;
  return Math.floor((minutes - 360) / 30);
}
function safeParseSlots(json: string | null): number[] {
  if (!json) return [];
  try { const a = JSON.parse(json); return Array.isArray(a) ? a.filter((n: unknown) => Number.isInteger(n)) : []; }
  catch { return []; }
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

  const bills = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, s.id));
  bills.sort((a, b) => a.weekIndex - b.weekIndex);

  return {
    ...base,
    cleanerName, customerName: cust?.name ?? null,
    daysCompleted: days.filter(d => d.status === "completed").length,
    days: days.map(d => ({ ...d, scheduledAt: d.scheduledAt.toISOString() })),
    bills: bills.map(b => ({
      id: b.id, weekIndex: b.weekIndex, washesCount: b.washesCount, amountDue: b.amountDue,
      status: b.status,
      weekStart: b.weekStart.toISOString(), weekEnd: b.weekEnd.toISOString(),
      dueDate: b.dueDate.toISOString(), paidAt: b.paidAt ? b.paidAt.toISOString() : null,
    })),
    amountDue: bills.filter(b => b.status === "due").reduce((sum, b) => sum + b.amountDue, 0),
  };
}

// GET /api/subscriptions/mine — the customer's active packages (with daily schedule).
router.get("/subscriptions/mine", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.customerId, userId), inArray(subscriptionsTable.status, ["active", "unassigned"]), gt(subscriptionsTable.expiresAt, new Date())));
  res.json(await Promise.all(subs.map(enrichPackage)));
});

// GET /api/subscriptions/previous-washers — washers who have completed a wash for this
// customer, each with live online status AND the time slots they're free for. A slot is
// "free" when it's in the washer's chosen availability AND not already taken by one of his
// active daily packages or upcoming bookings. Only these washers (online only) are pickable.
router.get("/subscriptions/previous-washers", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const done = await db.select({ cleanerId: bookingsTable.cleanerId }).from(bookingsTable)
    .where(and(eq(bookingsTable.customerId, userId), eq(bookingsTable.status, "completed")));
  const ids = [...new Set(done.map(d => d.cleanerId).filter((x): x is number => x != null))];
  if (ids.length === 0) { res.json([]); return; }

  const rows = await db.select({
    id: cleanersTable.id, name: usersTable.name, price: cleanersTable.pricePerClean,
    available: cleanersTable.available, isLoggedIn: usersTable.isLoggedIn, lastSeenAt: usersTable.lastSeenAt,
    slots: cleanersTable.availableSlots,
  }).from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(inArray(cleanersTable.id, ids));

  // Build each washer's occupied slots from existing commitments.
  const now = new Date();
  const pkgRows = await db.select({ cleanerId: subscriptionsTable.cleanerId, dailyMinutes: subscriptionsTable.dailyMinutes })
    .from(subscriptionsTable)
    .where(and(inArray(subscriptionsTable.cleanerId, ids), eq(subscriptionsTable.kind, "daily"), eq(subscriptionsTable.status, "active")));
  const bkRows = await db.select({ cleanerId: bookingsTable.cleanerId, scheduledAt: bookingsTable.scheduledAt })
    .from(bookingsTable)
    .where(and(inArray(bookingsTable.cleanerId, ids), inArray(bookingsTable.status, ["scheduled", "accepted", "arrived"]), gte(bookingsTable.scheduledAt, now)));

  const occupied = new Map<number, Set<number>>();
  const addOcc = (cid: number | null, slot: number) => {
    if (cid == null || slot < 0) return;
    if (!occupied.has(cid)) occupied.set(cid, new Set());
    occupied.get(cid)!.add(slot);
  };
  for (const p of pkgRows) if (p.dailyMinutes != null) addOcc(p.cleanerId, minutesToSlot(p.dailyMinutes));
  for (const bk of bkRows) addOcc(bk.cleanerId, dateToIstSlot(bk.scheduledAt));

  const STALE = 5 * 60 * 1000;
  const nowMs = Date.now();
  res.json(rows.map(r => {
    const chosen = safeParseSlots(r.slots);
    const base = chosen.length > 0 ? chosen : ALL_SLOTS; // no schedule set → free any time
    const occ = occupied.get(r.id) ?? new Set<number>();
    const freeSlots = base.filter(s => !occ.has(s)).sort((a, b) => a - b);
    return {
      cleanerId: r.id, name: r.name ?? "Washer", pricePerWash: r.price,
      online: !!(r.available && r.isLoggedIn && r.lastSeenAt && nowMs - new Date(r.lastSeenAt).getTime() < STALE),
      slots: freeSlots,
    };
  }).sort((a, b) => Number(b.online) - Number(a.online)));
});

// PATCH /api/subscriptions/:id/auto-assign — owner drops the preferred washer and lets
// the package dispatch to any available washer (used after a requested washer declines).
router.patch("/subscriptions/:id/auto-assign", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub || sub.customerId !== userId) { res.status(403).json({ error: "Not your package" }); return; }
  await db.update(subscriptionsTable).set({ status: "active", preferredCleanerId: null }).where(eq(subscriptionsTable.id, id));
  res.json({ ok: true });
});

// PATCH /api/subscriptions/:id/reassign { cleanerId } — owner requests a different
// previous washer. Only a washer who has worked for this customer, and is online, is allowed.
router.patch("/subscriptions/:id/reassign", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  const cleanerId = Number((req.body as Record<string, unknown>).cleanerId);
  if (isNaN(id) || !Number.isInteger(cleanerId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub || sub.customerId !== userId) { res.status(403).json({ error: "Not your package" }); return; }

  // Must be a washer who previously completed a wash for this customer.
  const [prior] = await db.select({ id: bookingsTable.id }).from(bookingsTable)
    .where(and(eq(bookingsTable.customerId, userId), eq(bookingsTable.cleanerId, cleanerId), eq(bookingsTable.status, "completed")));
  if (!prior) { res.status(400).json({ error: "not_previous_washer", message: "You can only pick a washer who has cleaned your car before." }); return; }

  await db.update(subscriptionsTable).set({ status: "active", preferredCleanerId: cleanerId }).where(eq(subscriptionsTable.id, id));
  res.json({ ok: true });
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
  const lat = b.latitude, lng = b.longitude;

  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes >= 1440) {
    res.status(400).json({ error: "invalid_time", message: "Pick a valid daily time." }); return;
  }
  if (![7, 30].includes(durationDays)) {
    res.status(400).json({ error: "invalid_duration", message: "Choose a weekly or monthly plan." }); return;
  }
  // Location (coordinates) is required; a text address is optional (we fall back to coords).
  if (lat == null || lng == null) {
    res.status(400).json({ error: "no_location", message: "Your location is required. Enable location access and try again." }); return;
  }
  const address = ((b.address as string) || "").trim() || `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;

  // Optional: owner re-requests a specific washer — only one who has cleaned his car
  // before (verified via a prior completed booking).
  let preferredCleanerId: number | null = null;
  let preferredRate: number | null = null;
  if (b.preferredCleanerId != null) {
    const cid = Number(b.preferredCleanerId);
    const [c] = await db.select().from(cleanersTable).where(eq(cleanersTable.id, cid));
    if (!c) { res.status(400).json({ error: "unknown_washer", message: "That washer is unavailable." }); return; }
    const [prior] = await db.select({ id: bookingsTable.id }).from(bookingsTable)
      .where(and(eq(bookingsTable.customerId, userId), eq(bookingsTable.cleanerId, cid), eq(bookingsTable.status, "completed")));
    if (!prior) { res.status(400).json({ error: "not_previous_washer", message: "You can only request a washer who has cleaned your car before." }); return; }

    // Re-check the chosen slot is still open for him — the availability list is a
    // snapshot, so he may have been booked between the owner seeing it and submitting.
    const slot = minutesToSlot(dailyMinutes);
    const avail = safeParseSlots(c.availableSlots);
    if (slot < 0 || (avail.length > 0 && !avail.includes(slot))) {
      res.status(409).json({ error: "washer_unavailable", message: "This washer isn’t available at that time anymore. Please pick another time or washer." }); return;
    }
    const occ = new Set<number>();
    const pk = await db.select({ dailyMinutes: subscriptionsTable.dailyMinutes }).from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.cleanerId, cid), eq(subscriptionsTable.kind, "daily"), eq(subscriptionsTable.status, "active")));
    for (const p of pk) if (p.dailyMinutes != null) occ.add(minutesToSlot(p.dailyMinutes));
    const bk = await db.select({ scheduledAt: bookingsTable.scheduledAt }).from(bookingsTable)
      .where(and(eq(bookingsTable.cleanerId, cid), inArray(bookingsTable.status, ["scheduled", "accepted", "arrived"]), gte(bookingsTable.scheduledAt, new Date())));
    for (const bb of bk) occ.add(dateToIstSlot(bb.scheduledAt));
    if (occ.has(slot)) {
      res.status(409).json({ error: "washer_just_booked", message: "This washer just got booked for that time. Please pick another time or washer." }); return;
    }

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

  // Final settlement: bill any washes already done that haven't been billed yet, so the
  // amount owed for work delivered is recorded and the washer can collect it.
  if (sub.kind === "daily" && sub.cleanerId) {
    const rate = sub.pricePerWash ?? 0;
    const doneRows = await db.select({ id: bookingsTable.id }).from(bookingsTable)
      .where(and(eq(bookingsTable.subscriptionId, id), eq(bookingsTable.status, "completed")));
    const existingBills = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, id));
    const billedWashes = existingBills.reduce((s, x) => s + x.washesCount, 0);
    const unbilled = doneRows.length - billedWashes;
    if (unbilled > 0 && rate > 0) {
      const now = new Date();
      const nextWeek = existingBills.reduce((m, x) => Math.max(m, x.weekIndex + 1), 0);
      await db.insert(packageBillsTable).values({
        subscriptionId: id, weekIndex: nextWeek, weekStart: now, weekEnd: now,
        washesCount: unbilled, amountDue: unbilled * rate, status: "due",
        dueDate: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
      }).onConflictDoNothing();
    }
  }

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

// PATCH /api/subscriptions/:id/bills/:billId/paid — the bound washer confirms he was
// paid (offline) for a weekly bill. The owner then sees it marked Paid.
router.patch("/subscriptions/:id/bills/:billId/paid", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  const billId = parseInt(req.params.billId, 10);
  if (isNaN(id) || isNaN(billId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Package not found" }); return; }
  // Either side may confirm payment: the bound washer ("received") or the owner ("paid").
  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  const isWasher = cleaner != null && sub.cleanerId === cleaner.id;
  const isOwner = sub.customerId === userId;
  if (!isWasher && !isOwner) { res.status(403).json({ error: "Not your package" }); return; }

  const [bill] = await db.select().from(packageBillsTable)
    .where(and(eq(packageBillsTable.id, billId), eq(packageBillsTable.subscriptionId, id)));
  if (!bill) { res.status(404).json({ error: "Bill not found" }); return; }
  if (bill.status === "paid") { res.json({ ok: true, alreadyPaid: true }); return; }

  await db.update(packageBillsTable).set({ status: "paid", paidAt: new Date() }).where(eq(packageBillsTable.id, billId));
  // Notify the OTHER party.
  if (isWasher) {
    await pushToUser(sub.customerId, "Payment confirmed ✓", `Your washer confirmed ₹${bill.amountDue} received for week ${bill.weekIndex + 1}.`, { type: "package_bill_paid", subscriptionId: id });
  } else if (sub.cleanerId) {
    const [c] = await db.select({ uid: cleanersTable.userId }).from(cleanersTable).where(eq(cleanersTable.id, sub.cleanerId));
    if (c) await pushToUser(c.uid, "Owner marked paid ✓", `The owner marked ₹${bill.amountDue} for week ${bill.weekIndex + 1} as paid.`, { type: "package_bill_paid", subscriptionId: id });
  }
  res.json({ ok: true });
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
