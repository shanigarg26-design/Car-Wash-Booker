/**
 * Booking Service – HTTP Router
 * Thin Express layer. All business logic lives in service.ts; dispatch
 * engine lives in dispatcher.ts. This file only handles HTTP concerns
 * (parsing IDs, calling service functions, returning responses).
 */
import { Router, type IRouter } from "express";
import { db, bookingsTable, usersTable, cleanersTable, bookingDispatchesTable, subscriptionsTable } from "@workspace/db";
import { eq, and, ne, inArray, gt } from "drizzle-orm";
import {
  CreateBookingBody,
  GetBookingParams,
  AcceptBookingParams,
  DeclineBookingParams,
  CompleteBookingParams,
  CancelBookingParams,
  ListBookingsResponse,
  GetBookingResponse,
} from "@workspace/api-zod";
import { enrichBooking, calcPrice, generateServiceOtp, calcProratedAmount } from "./service.js";
import { findCoveringSubscription } from "../subscription/router.js";
import { dispatchToNearestCleaners, scheduleSearchRetry, cancelRetry, MAX_DISPATCH, MAX_DISPATCH_RADIUS_KM, haversineKm } from "./dispatcher.js";
import { sendPush } from "../../shared/push.js";

const router: IRouter = Router();

// Brute-force guard for the service-start OTP (a 4-digit code). Tracks wrong
// attempts per booking; after MAX_OTP_ATTEMPTS the cleaner must have the customer
// re-share the OTP (which resets the counter). In-memory is fine — a restart just
// clears the (short-lived) lock, and there is no security downside to that.
const otpAttempts = new Map<number, number>();
const MAX_OTP_ATTEMPTS = 5;

// ── GET /api/bookings ─────────────────────────────────────────────────────────
router.get("/bookings", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const role = req.query.role as string | undefined;
  let bookings: (typeof bookingsTable.$inferSelect)[] = [];

  if (role === "cleaner") {
    const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
    if (!cleaner) { res.json([]); return; }

    // Heartbeat: the cleaner dashboard polls this every few seconds, so a cleaner
    // with the app open stays "online" for dispatch even if background location
    // updates aren't running. A phone that's off stops polling → goes stale.
    if (cleaner.available) {
      await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
    }

    // Fetch dispatches across all relevant statuses
    const allDispatches = await db.select().from(bookingDispatchesTable).where(
      and(
        eq(bookingDispatchesTable.cleanerId, cleaner.id),
        inArray(bookingDispatchesTable.status, ["pending", "accepted", "cleaner_cancelled"])
      )
    );

    const activeDispatchIds      = allDispatches.filter(d => d.status !== "cleaner_cancelled").map(d => d.bookingId);
    const cleanerCancelledIds    = allDispatches.filter(d => d.status === "cleaner_cancelled").map(d => d.bookingId);

    // Bookings where this cleaner is/was assigned as cleaner (active, arrived, in_progress, completed).
    // EXCLUDE customer-cancelled ones — those belong only in the customer's history.
    const assignedBookings = await db.select().from(bookingsTable).where(
      and(eq(bookingsTable.cleanerId, cleaner.id), ne(bookingsTable.status, "cancelled"))
    );

    // Pending/dispatched bookings (not yet accepted)
    const pendingBookings = activeDispatchIds.length > 0
      ? await db.select().from(bookingsTable).where(inArray(bookingsTable.id, activeDispatchIds))
      : [];

    // Bookings the cleaner cancelled — shown as "Cancelled" in THEIR history only
    const rawCancelledByCleanerBookings = cleanerCancelledIds.length > 0
      ? await db.select().from(bookingsTable).where(inArray(bookingsTable.id, cleanerCancelledIds))
      : [];
    const cancelledByCleanerBookings = rawCancelledByCleanerBookings.map(b => ({ ...b, status: "cancelled" as const }));

    const assignedIds = new Set(assignedBookings.map(b => b.id));
    const pendingIds  = new Set(pendingBookings.map(b => b.id));

    const all = [
      ...assignedBookings,
      ...pendingBookings.filter(b => !assignedIds.has(b.id)),
      ...cancelledByCleanerBookings.filter(b => !assignedIds.has(b.id) && !pendingIds.has(b.id)),
    ];
    bookings = Array.from(new Map(all.map(b => [b.id, b])).values());

  } else {
    // Customer view — shows all their bookings including ones THEY cancelled.
    // Bookings where a cleaner cancelled but re-search succeeded stay as their current status.
    bookings = await db.select().from(bookingsTable).where(eq(bookingsTable.customerId, userId));
  }

  const enriched = await Promise.all(bookings.map(enrichBooking));
  res.json(ListBookingsResponse.parse(enriched));
});

// ── POST /api/bookings ────────────────────────────────────────────────────────
router.post("/bookings", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { customerAddress, customerLat, customerLng, notes, vehicleType, washType, scheduledAt } = parsed.data;

  // A future scheduledAt (>1 min ahead) makes this a SCHEDULED booking: it waits
  // until its time, then the sweep cron promotes it to "searching" and dispatches.
  let scheduledFor = new Date();
  let isScheduled = false;
  if (scheduledAt) {
    const dt = new Date(scheduledAt);
    if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() + 60_000) { scheduledFor = dt; isScheduled = true; }
  }

  // Defensive length caps — the app sends short values, but reject abusive payloads.
  if (customerAddress.length > 500) { res.status(400).json({ error: "address_too_long", message: "Address is too long." }); return; }
  if (notes != null && notes.length > 1000) { res.status(400).json({ error: "notes_too_long", message: "Notes are too long." }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const cleanTypeFinal = washType ?? "exterior";

  // Quantity: a customer can book several cars at once (e.g. two cars at home).
  // Clamp to a sane range so an abusive payload can't spawn hundreds of searches.
  const quantity = Math.min(Math.max(Math.trunc(Number(req.body?.quantity)) || 1, 1), 5);

  // Customers may now have MULTIPLE active bookings (different cars). We only guard
  // against an accidental double-tap: an identical booking (same address, vehicle and
  // wash type) created in the last few seconds. Deliberate bookings — a different car,
  // or the same car a moment later, or a batch via `quantity` — are allowed.
  const activeStatuses = ["searching", "scheduled", "accepted", "arrived", "in_progress"] as const;
  const dupeCutoff = new Date(Date.now() - 8000);
  const dupeConds = [
    eq(bookingsTable.customerId, userId),
    eq(bookingsTable.customerAddress, customerAddress),
    eq(bookingsTable.cleanType, cleanTypeFinal),
    gt(bookingsTable.createdAt, dupeCutoff),
    inArray(bookingsTable.status, activeStatuses as unknown as string[]),
  ];
  if (vehicleType) dupeConds.push(eq(bookingsTable.vehicleType, vehicleType));
  const [dupe] = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(...dupeConds));
  if (dupe) {
    res.status(409).json({ error: "duplicate_too_fast", message: "Looks like a duplicate tap — please wait a moment before booking the same car again." });
    return;
  }

  const lat            = customerLat ?? user.latitude ?? null;
  const lng            = customerLng ?? user.longitude ?? null;

  // A booking with no coordinates can never be matched to a nearby cleaner (it would
  // just search for 5 min and auto-cancel). Reject upfront with a clear message.
  if (lat == null || lng == null) {
    res.status(400).json({ error: "location_required", message: "We need your location to find a nearby cleaner. Please enable location access and try again." });
    return;
  }

  const price = calcPrice(vehicleType, washType);

  // Prepaid package coverage: apply it across the batch up to the package's remaining
  // washes (findCoveringSubscription only reads, so we track remaining capacity here).
  const coveringSub    = await findCoveringSubscription(userId, vehicleType ?? null, cleanTypeFinal);
  let remainingCovered = coveringSub ? Math.max(0, coveringSub.washesTotal - coveringSub.washesUsed) : 0;

  const created: (typeof bookingsTable.$inferSelect)[] = [];
  for (let i = 0; i < quantity; i++) {
    const subId = remainingCovered > 0 ? coveringSub!.id : null;
    if (subId) remainingCovered--;

    const [booking] = await db.insert(bookingsTable).values({
      customerId: userId, cleanerId: null, customerAddress,
      customerLat: lat, customerLng: lng, scheduledAt: scheduledFor,
      notes: notes ?? null, vehicleType: vehicleType ?? null,
      cleanType: cleanTypeFinal, priceQuoted: price, status: isScheduled ? "scheduled" : "searching",
      subscriptionId: subId,
    }).returning();

    // Only dispatch immediate bookings. Scheduled ones are picked up at their time
    // by the sweep cron (promoteScheduledBookings in dispatcher.ts).
    if (!isScheduled) {
      await dispatchToNearestCleaners(booking.id, lat, lng, [], MAX_DISPATCH, {
        vehicleType: vehicleType ?? null, cleanType: cleanTypeFinal, address: customerAddress, price,
      });
      scheduleSearchRetry(booking.id, lat, lng, vehicleType ?? null, cleanTypeFinal, customerAddress, price, Date.now());
    }
    created.push(booking);
  }

  // Return the first booking (backward compatible with single-booking clients).
  // The full set is available under `bookings` for multi-car aware clients.
  const enrichedAll = await Promise.all(created.map(b => enrichBooking(b)));
  res.status(201).json({
    ...GetBookingResponse.parse(enrichedAll[0]),
    bookings: enrichedAll.map(e => GetBookingResponse.parse(e)),
    quantity,
  });
});

// ── PATCH /api/bookings/:id/edit ──────────────────────────────────────────────
// Customer changes vehicle / wash type / notes BEFORE a cleaner accepts. Price is
// recomputed and package coverage re-evaluated.
router.patch("/bookings/:id/edit", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const { vehicleType, washType, notes } = req.body as { vehicleType?: string; washType?: string; notes?: string };

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.customerId !== userId) { res.status(403).json({ error: "Not your booking" }); return; }
  if (!["searching", "scheduled"].includes(booking.status)) {
    res.status(409).json({ error: "cannot_edit", message: "You can only edit a booking before a cleaner accepts it." }); return;
  }
  if (notes != null && notes.length > 1000) { res.status(400).json({ error: "notes_too_long", message: "Notes are too long." }); return; }

  const newVehicle = vehicleType !== undefined ? vehicleType : booking.vehicleType;
  const newClean   = washType === "both" || washType === "exterior" ? washType : (booking.cleanType ?? "exterior");
  const newPrice   = calcPrice(newVehicle, newClean);
  const coveringSub = await findCoveringSubscription(userId, newVehicle ?? null, newClean);

  const [updated] = await db.update(bookingsTable).set({
    vehicleType: newVehicle, cleanType: newClean, priceQuoted: newPrice,
    notes: notes !== undefined ? notes : booking.notes,
    subscriptionId: coveringSub?.id ?? null,
  }).where(eq(bookingsTable.id, bookingId)).returning();

  res.json(GetBookingResponse.parse(await enrichBooking(updated)));
});

// ── GET /api/bookings/:id/nearby-cleaners ─────────────────────────────────────
router.get("/bookings/:id/nearby-cleaners", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking || booking.customerId !== userId) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!booking.customerLat || !booking.customerLng) { res.json({ cleaners: [] }); return; }

  const allCleaners = await db
    .select({ id: cleanersTable.id, lat: usersTable.latitude, lng: usersTable.longitude })
    .from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(and(eq(cleanersTable.available, true), eq(usersTable.isLoggedIn, true)));

  const nearby = allCleaners
    .filter(w => w.lat !== null && w.lng !== null)
    .map(w => ({ id: w.id, lat: w.lat!, lng: w.lng!, dist: haversineKm(booking.customerLat!, booking.customerLng!, w.lat!, w.lng!) }))
    .filter(w => w.dist <= MAX_DISPATCH_RADIUS_KM)
    .sort((a, b) => a.dist - b.dist);

  res.json({ cleaners: nearby, washers: nearby });
});

// Legacy alias
router.get("/bookings/:id/nearby-washers", async (req, res): Promise<void> => {
  res.redirect(307, `/api/bookings/${req.params.id}/nearby-cleaners`);
});

// ── GET /api/bookings/:id/cleaner-location ────────────────────────────────────
router.get("/bookings/:id/cleaner-location", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking || booking.customerId !== userId) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!booking.cleanerId || !["accepted", "arrived", "in_progress"].includes(booking.status)) {
    res.json({ lat: null, lng: null, name: null }); return;
  }

  const [cleaner] = await db
    .select({ lat: usersTable.latitude, lng: usersTable.longitude, name: usersTable.name })
    .from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(eq(cleanersTable.id, booking.cleanerId));

  res.json({ lat: cleaner?.lat ?? null, lng: cleaner?.lng ?? null, name: cleaner?.name ?? null });
});

// Legacy alias
router.get("/bookings/:id/washer-location", async (req, res): Promise<void> => {
  res.redirect(307, `/api/bookings/${req.params.id}/cleaner-location`);
});

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
router.get("/bookings/:id", async (req, res): Promise<void> => {
  const session = req.session as unknown as Record<string, unknown>;
  const userId  = session.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  // Only participants may view a booking — the response exposes the service OTP
  // and the customer's phone, address and GPS coordinates. Allowed viewers:
  // the owning customer, the assigned or dispatched cleaner, or an admin.
  let allowed = booking.customerId === userId || session.isAdmin === true;
  if (!allowed) {
    const [cleaner] = await db.select({ id: cleanersTable.id })
      .from(cleanersTable).where(eq(cleanersTable.userId, userId));
    if (cleaner) {
      if (booking.cleanerId === cleaner.id) {
        allowed = true;
      } else {
        const [dispatch] = await db.select({ id: bookingDispatchesTable.id })
          .from(bookingDispatchesTable)
          .where(and(
            eq(bookingDispatchesTable.bookingId, booking.id),
            eq(bookingDispatchesTable.cleanerId, cleaner.id),
          ));
        if (dispatch) allowed = true;
      }
    }
  }
  if (!allowed) { res.status(403).json({ error: "Not authorized to view this booking" }); return; }

  res.json(GetBookingResponse.parse(await enrichBooking(booking)));
});

// ── PATCH /api/bookings/:id/accept ───────────────────────────────────────────
router.patch("/bookings/:id/accept", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = AcceptBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.status(403).json({ error: "Not a cleaner" }); return; }

  // A cleaner can only handle one job at a time. Do the whole check-and-claim in
  // a single transaction that first takes a row lock on THIS cleaner (FOR UPDATE).
  // Two accepts from the same cleaner (e.g. rapid taps on two different request
  // cards, or two devices) serialize on that lock: the first commits its job, the
  // second then sees the active job and is rejected — so a cleaner can never end
  // up assigned to two bookings at once.
  const otp = generateServiceOtp();
  const outcome = await db.transaction(async (tx) => {
    await tx.select({ id: cleanersTable.id }).from(cleanersTable)
      .where(eq(cleanersTable.id, cleaner.id)).for("update");

    const [activeJob] = await tx.select({ id: bookingsTable.id }).from(bookingsTable).where(
      and(eq(bookingsTable.cleanerId, cleaner.id), inArray(bookingsTable.status, ["accepted", "arrived", "in_progress"])),
    );
    if (activeJob) return { kind: "active_job" as const };

    const [dispatch] = await tx.select().from(bookingDispatchesTable).where(
      and(eq(bookingDispatchesTable.bookingId, params.data.id), eq(bookingDispatchesTable.cleanerId, cleaner.id), eq(bookingDispatchesTable.status, "pending"))
    );
    if (!dispatch) return { kind: "not_dispatched" as const };

    // Atomic claim: only ONE cleaner can flip the booking from "searching" → "accepted".
    const [updated] = await tx.update(bookingsTable)
      .set({ status: "accepted", cleanerId: cleaner.id, serviceOtp: otp })
      .where(and(eq(bookingsTable.id, params.data.id), eq(bookingsTable.status, "searching")))
      .returning();
    if (!updated) return { kind: "taken" as const };

    // Won the race — finalize dispatch rows.
    await tx.update(bookingDispatchesTable).set({ status: "accepted" }).where(eq(bookingDispatchesTable.id, dispatch.id));
    await tx.update(bookingDispatchesTable).set({ status: "cancelled" }).where(
      and(eq(bookingDispatchesTable.bookingId, params.data.id), ne(bookingDispatchesTable.id, dispatch.id), eq(bookingDispatchesTable.status, "pending"))
    );
    return { kind: "ok" as const, booking: updated };
  });

  if (outcome.kind === "active_job") { res.status(409).json({ error: "active_job_exists", message: "Finish your current job before accepting a new one." }); return; }
  if (outcome.kind === "not_dispatched") { res.status(403).json({ error: "Not dispatched to you or already handled" }); return; }
  if (outcome.kind === "taken") { res.status(409).json({ error: "Booking already taken or not available" }); return; }

  // Stop the search loop now that the booking is claimed.
  cancelRetry(params.data.id);

  const enriched  = await enrichBooking(outcome.booking);

  if (enriched._customerPushToken) {
    await sendPush([enriched._customerPushToken], "🧹 Cleaner Accepted Your Booking!", `${enriched.cleanerName} is on the way. Get ready!`, { type: "booking_accepted", bookingId: outcome.booking.id });
  }

  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/decline ──────────────────────────────────────────
router.patch("/bookings/:id/decline", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeclineBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.status(403).json({ error: "Not a cleaner" }); return; }

  const [dispatch] = await db.select().from(bookingDispatchesTable).where(
    and(eq(bookingDispatchesTable.bookingId, params.data.id), eq(bookingDispatchesTable.cleanerId, cleaner.id), eq(bookingDispatchesTable.status, "pending"))
  );
  if (!dispatch) { res.status(403).json({ error: "Not dispatched to you or already handled" }); return; }

  await db.update(bookingDispatchesTable).set({ status: "declined" }).where(eq(bookingDispatchesTable.id, dispatch.id));

  const allDispatches = await db.select().from(bookingDispatchesTable).where(eq(bookingDispatchesTable.bookingId, params.data.id));
  const pendingCount  = allDispatches.filter(d => d.status === "pending").length;

  if (pendingCount === 0) {
    const [bk] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
    if (bk && bk.status === "searching") {
      const newDispatched = await dispatchToNearestCleaners(
        params.data.id, bk.customerLat ?? null, bk.customerLng ?? null,
        allDispatches.map(d => d.cleanerId), MAX_DISPATCH,
        { vehicleType: bk.vehicleType ?? null, cleanType: bk.cleanType ?? "exterior", address: bk.customerAddress, price: bk.priceQuoted }
      );
      if (newDispatched === 0) await db.update(bookingsTable).set({ status: "cancelled" }).where(eq(bookingsTable.id, params.data.id));
    }
  }

  const [refreshed] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  res.json(GetBookingResponse.parse(await enrichBooking(refreshed)));
});

// ── PATCH /api/bookings/:id/arrive ───────────────────────────────────────────
router.patch("/bookings/:id/arrive", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.status(403).json({ error: "Not a cleaner" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking || booking.cleanerId !== cleaner.id || booking.status !== "accepted") { res.status(403).json({ error: "Cannot mark arrival for this booking" }); return; }

  const [updated] = await db.update(bookingsTable).set({ status: "arrived" }).where(eq(bookingsTable.id, bookingId)).returning();
  const enriched  = await enrichBooking(updated);

  if (enriched._customerPushToken) {
    await sendPush([enriched._customerPushToken], "🚗 Your Cleaner Has Arrived!", `${enriched.cleanerName} is here. Share your OTP to start the clean.`, { type: "cleaner_arrived", bookingId });
  }

  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/share-otp ────────────────────────────────────────
router.patch("/bookings/:id/share-otp", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking || booking.customerId !== userId || booking.status !== "arrived") { res.status(403).json({ error: "Cannot share OTP for this booking" }); return; }

  const [updated] = await db.update(bookingsTable).set({ otpShared: true }).where(eq(bookingsTable.id, bookingId)).returning();
  otpAttempts.delete(bookingId); // fresh share → clear any prior lockout
  const enriched  = await enrichBooking(updated);

  if (enriched._cleanerPushToken && updated.serviceOtp) {
    await sendPush([enriched._cleanerPushToken], "🔑 OTP Shared by Customer", `Your OTP is: ${updated.serviceOtp} — confirm to start the clean.`, { type: "otp_shared", bookingId, otp: updated.serviceOtp });
  }

  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/start ─────────────────────────────────────────────
router.patch("/bookings/:id/start", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { otp } = req.body as { otp?: string };
  if (!otp) { res.status(400).json({ error: "OTP is required" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.status(403).json({ error: "Not a cleaner" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking || booking.cleanerId !== cleaner.id || booking.status !== "arrived") { res.status(403).json({ error: "Cannot start this booking" }); return; }
  if (!booking.otpShared) { res.status(409).json({ error: "Customer has not shared the OTP yet" }); return; }

  if ((otpAttempts.get(bookingId) ?? 0) >= MAX_OTP_ATTEMPTS) {
    res.status(429).json({ error: "otp_locked", message: "Too many incorrect attempts. Ask the customer to re-share the OTP." }); return;
  }
  if (booking.serviceOtp !== otp.trim()) {
    otpAttempts.set(bookingId, (otpAttempts.get(bookingId) ?? 0) + 1);
    res.status(400).json({ error: "incorrect_otp", message: "Incorrect OTP. Please try again." }); return;
  }
  otpAttempts.delete(bookingId); // correct OTP → clear counter

  const [updated] = await db.update(bookingsTable).set({ status: "in_progress", serviceStartedAt: new Date() }).where(eq(bookingsTable.id, bookingId)).returning();
  const enriched  = await enrichBooking(updated);

  if (enriched._customerPushToken) {
    await sendPush([enriched._customerPushToken], "🧽 Clean Started!", `${enriched.cleanerName} has started cleaning your car.`, { type: "clean_started", bookingId });
  }

  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/complete ─────────────────────────────────────────
router.patch("/bookings/:id/complete", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = CompleteBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Booking not found" }); return; }

  // Only the assigned cleaner or the booking's customer may complete it.
  const [cleaner] = await db.select({ id: cleanersTable.id }).from(cleanersTable).where(eq(cleanersTable.userId, userId));
  const isAssignedCleaner = !!cleaner && existing.cleanerId === cleaner.id;
  const isCustomer        = existing.customerId === userId;
  if (!isAssignedCleaner && !isCustomer) { res.status(403).json({ error: "Not authorized to complete this booking" }); return; }
  // Completion requires the service to have actually started (OTP verified) — this
  // stops a job being marked done without the customer's OTP consent.
  if (existing.status !== "in_progress") {
    res.status(409).json({ error: "not_in_progress", message: "The service must be started (via the customer's OTP) before it can be completed." }); return;
  }

  // Covered by a prepaid package → customer owes ₹0 and one wash is consumed.
  // Otherwise a normal, full completion at the quoted price.
  const chargeAmt = existing.subscriptionId ? 0 : existing.priceQuoted;
  const [booking] = await db.update(bookingsTable).set({ status: "completed", amountCharged: chargeAmt, completedAt: new Date() }).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (existing.subscriptionId) {
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, existing.subscriptionId));
    if (sub) await db.update(subscriptionsTable).set({ washesUsed: sub.washesUsed + 1 }).where(eq(subscriptionsTable.id, sub.id));
  }

  if (booking.cleanerId) {
    const [c] = await db.select().from(cleanersTable).where(eq(cleanersTable.id, booking.cleanerId));
    if (c) await db.update(cleanersTable).set({ totalCleans: c.totalCleans + 1 }).where(eq(cleanersTable.id, c.id));
  }

  res.json(GetBookingResponse.parse(await enrichBooking(booking)));
});

// ── PATCH /api/bookings/:id/stop ──────────────────────────────────────────────
// EITHER party (the assigned washer OR the customer) can stop the wash mid-service
// (e.g. an emergency). The customer is charged only for the time actually spent,
// auto-prorated from when the service started. Marked completed + stopped-early.
// This is DIFFERENT from cancel — a cancel is free; a stop bills for time spent.
router.patch("/bookings/:id/stop", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!existing) { res.status(404).json({ error: "Booking not found" }); return; }

  const [cleaner] = await db.select({ id: cleanersTable.id }).from(cleanersTable).where(eq(cleanersTable.userId, userId));
  const isAssignedCleaner = !!cleaner && existing.cleanerId === cleaner.id;
  const isCustomer        = existing.customerId === userId;
  if (!isAssignedCleaner && !isCustomer) { res.status(403).json({ error: "Not authorized to stop this booking" }); return; }
  if (existing.status !== "in_progress") { res.status(409).json({ error: "not_in_progress", message: "You can only stop a wash that is in progress." }); return; }

  const stoppedBy = isCustomer ? "customer" : "cleaner";
  const { amount, fraction, minutesSpent } = calcProratedAmount(existing.priceQuoted, existing.cleanType, existing.serviceStartedAt);
  // A package-covered wash is already prepaid → the customer owes ₹0 even if stopped early.
  const chargeAmt = existing.subscriptionId ? 0 : amount;

  const [booking] = await db.update(bookingsTable)
    .set({ status: "completed", stoppedEarly: true, stoppedBy, amountCharged: chargeAmt, completedAt: new Date() })
    .where(eq(bookingsTable.id, bookingId)).returning();

  if (existing.subscriptionId) {
    const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, existing.subscriptionId));
    if (sub) await db.update(subscriptionsTable).set({ washesUsed: sub.washesUsed + 1 }).where(eq(subscriptionsTable.id, sub.id));
  }

  const enriched = await enrichBooking(booking);
  const who = isCustomer ? "The customer" : "Your cleaner";
  const money = existing.subscriptionId ? "This wash was covered by your package." : `Amount for time spent: ₹${amount} (of ₹${existing.priceQuoted}).`;
  // Notify the OTHER party.
  const notifyToken = isCustomer ? enriched._cleanerPushToken : enriched._customerPushToken;
  if (notifyToken) {
    await sendPush([notifyToken], "⚠️ Wash ended early",
      `${who} stopped the wash after ~${minutesSpent} min. ${money}`,
      { type: "service_stopped", bookingId, amountCharged: chargeAmt, stoppedBy });
  }

  console.log(`[Stop] Booking ${bookingId} stopped early by ${stoppedBy} at ${Math.round(fraction * 100)}% → ₹${chargeAmt}`);
  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/find-new-cleaner ──────────────────────────────────
// The customer's assigned washer accepted but isn't responding/showing up. The
// customer frees this washer and restarts the search for a NEW one. No charge —
// this only re-dispatches; the previous washer is dropped. (Different from cancel.)
router.patch("/bookings/:id/find-new-cleaner", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.customerId !== userId) { res.status(403).json({ error: "Not your booking" }); return; }
  if (!["accepted", "arrived"].includes(booking.status)) {
    res.status(409).json({ error: "cannot_reassign", message: "You can only search for a new cleaner before the wash starts." }); return;
  }

  const oldCleanerId = booking.cleanerId;
  // Drop the current washer's dispatch, and notify them.
  if (oldCleanerId) {
    await db.update(bookingDispatchesTable).set({ status: "cleaner_cancelled" })
      .where(and(eq(bookingDispatchesTable.bookingId, bookingId), eq(bookingDispatchesTable.cleanerId, oldCleanerId)));
    try {
      const [cu] = await db.select({ token: usersTable.expoPushToken }).from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id)).where(eq(cleanersTable.id, oldCleanerId));
      if (cu?.token) await sendPush([cu.token], "🔄 Booking reassigned", "The customer is searching for another cleaner for this booking.", { type: "booking_reassigned", bookingId });
    } catch { /* non-critical */ }
  }

  const [updated] = await db.update(bookingsTable)
    .set({ status: "searching", cleanerId: null, otpShared: false, serviceOtp: null })
    .where(eq(bookingsTable.id, bookingId)).returning();

  // Re-dispatch excluding everyone already tried (incl. the dropped washer).
  const tried = await db.select({ cleanerId: bookingDispatchesTable.cleanerId }).from(bookingDispatchesTable).where(eq(bookingDispatchesTable.bookingId, bookingId));
  const dispatched = await dispatchToNearestCleaners(bookingId, booking.customerLat, booking.customerLng, tried.map(d => d.cleanerId), MAX_DISPATCH,
    { vehicleType: booking.vehicleType, cleanType: booking.cleanType ?? "exterior", address: booking.customerAddress, price: booking.priceQuoted });
  scheduleSearchRetry(bookingId, booking.customerLat, booking.customerLng, booking.vehicleType, booking.cleanType ?? "exterior", booking.customerAddress, booking.priceQuoted, Date.now());

  console.log(`[FindNewCleaner] Booking ${bookingId} reassigned by customer; re-dispatched to ${dispatched} cleaner(s)`);
  res.json(GetBookingResponse.parse(await enrichBooking(updated)));
});

// ── PATCH /api/bookings/:id/cleaner-cancel ────────────────────────────────────
router.patch("/bookings/:id/cleaner-cancel", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (!cleaner) { res.status(403).json({ error: "Not a cleaner" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.cleanerId !== cleaner.id) { res.status(403).json({ error: "You are not assigned to this booking" }); return; }
  if (!["accepted", "arrived"].includes(booking.status)) { res.status(409).json({ error: "Booking cannot be cancelled at this stage" }); return; }

  // Mark as "cleaner_cancelled" (not "declined") so this booking appears
  // as "Cancelled" in the cleaner's own history, but NOT in the customer's.
  await db.update(bookingDispatchesTable).set({ status: "cleaner_cancelled" }).where(and(eq(bookingDispatchesTable.bookingId, bookingId), eq(bookingDispatchesTable.cleanerId, cleaner.id)));

  const [updated] = await db.update(bookingsTable).set({ status: "searching", cleanerId: null, otpShared: false, serviceOtp: null }).where(eq(bookingsTable.id, bookingId)).returning();

  const triedDispatches = await db.select({ cleanerId: bookingDispatchesTable.cleanerId }).from(bookingDispatchesTable).where(eq(bookingDispatchesTable.bookingId, bookingId));
  const excludeIds      = triedDispatches.map(d => d.cleanerId);

  const dispatched = await dispatchToNearestCleaners(bookingId, booking.customerLat, booking.customerLng, excludeIds, MAX_DISPATCH,
    { vehicleType: booking.vehicleType, cleanType: booking.cleanType ?? "exterior", address: booking.customerAddress, price: booking.priceQuoted }
  );

  scheduleSearchRetry(bookingId, booking.customerLat, booking.customerLng, booking.vehicleType, booking.cleanType ?? "exterior", booking.customerAddress, booking.priceQuoted, Date.now());

  console.log(`[CleanerCancel] Booking ${bookingId} reset to searching; dispatched to ${dispatched} new cleaner(s)`);

  res.json(GetBookingResponse.parse(await enrichBooking(updated)));
});

// Legacy alias for washer-cancel
router.patch("/bookings/:id/washer-cancel", async (req, res): Promise<void> => {
  res.redirect(307, `/api/bookings/${req.params.id}/cleaner-cancel`);
});

// ── PATCH /api/bookings/:id/relocate ─────────────────────────────────────────
// Lets the customer drag their pin on the map to a new location while the
// system is still searching.  Cancels the current retry loop, clears pending
// dispatches, reverses-geocodes the new address, updates the booking, and
// re-dispatches to the 5 nearest cleaners at the new spot.
router.patch("/bookings/:id/relocate", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const { lat, lng } = req.body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    res.status(400).json({ error: "lat and lng must be numbers" }); return;
  }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.customerId !== userId) { res.status(403).json({ error: "Not your booking" }); return; }
  if (booking.status !== "searching") {
    res.status(409).json({ error: "Can only relocate while the system is searching for a cleaner" }); return;
  }

  // Reverse-geocode the new coordinates (Nominatim — free, no key required)
  let newAddress = booking.customerAddress;
  try {
    const geoRes  = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { "User-Agent": "CarCleanPro/1.0 (contact@carcleanpro.in)" } },
    );
    const geoData = await geoRes.json() as { display_name?: string };
    if (geoData.display_name) newAddress = geoData.display_name;
  } catch {
    // Geocoding is non-fatal — keep the old address if it fails
  }

  // Cancel the in-flight retry loop so the old coordinates stop being used
  cancelRetry(bookingId);

  // Remove pending dispatches so those cleaners no longer see the old request
  // and can be re-dispatched to the new location if they are nearest
  await db.delete(bookingDispatchesTable).where(
    and(
      eq(bookingDispatchesTable.bookingId, bookingId),
      eq(bookingDispatchesTable.status, "pending"),
    ),
  );

  // Update the booking's coordinates + address
  const [updated] = await db
    .update(bookingsTable)
    .set({ customerLat: lat, customerLng: lng, customerAddress: newAddress })
    .where(eq(bookingsTable.id, bookingId))
    .returning();

  // Re-dispatch to the nearest cleaners at the new location (fresh slate)
  const dispatched = await dispatchToNearestCleaners(
    bookingId, lat, lng, [], MAX_DISPATCH,
    { vehicleType: booking.vehicleType, cleanType: booking.cleanType ?? "exterior", address: newAddress, price: booking.priceQuoted },
  );

  // Schedule new search-retry loop from this moment (fresh 5-min window)
  scheduleSearchRetry(bookingId, lat, lng, booking.vehicleType, booking.cleanType ?? "exterior", newAddress, booking.priceQuoted, Date.now());

  console.log(`[Relocate] Booking ${bookingId} moved → (${lat.toFixed(4)}, ${lng.toFixed(4)}); dispatched to ${dispatched} cleaner(s)`);

  res.json(GetBookingResponse.parse(await enrichBooking(updated)));
});

// ── PATCH /api/bookings/:id/customer-cancel ───────────────────────────────────
router.patch("/bookings/:id/customer-cancel", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.customerId !== userId) { res.status(403).json({ error: "Not your booking" }); return; }
  if (!["accepted", "arrived"].includes(booking.status)) { res.status(409).json({ error: "Booking cannot be cancelled at this stage" }); return; }

  await db.update(bookingDispatchesTable).set({ status: "cancelled" }).where(and(eq(bookingDispatchesTable.bookingId, bookingId), eq(bookingDispatchesTable.status, "pending")));

  const [updated] = await db.update(bookingsTable).set({ status: "cancelled" }).where(eq(bookingsTable.id, bookingId)).returning();

  if (booking.cleanerId) {
    try {
      const [cu] = await db.select({ pushToken: usersTable.expoPushToken }).from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id)).where(eq(cleanersTable.id, booking.cleanerId));
      if (cu?.pushToken) await sendPush([cu.pushToken], "❌ Booking Cancelled", "The customer has cancelled this booking.", { type: "booking_cancelled", bookingId });
    } catch { /* non-critical */ }
  }

  res.json(GetBookingResponse.parse(await enrichBooking(updated)));
});

// ── PATCH /api/bookings/:id/cancel (customer searching-cancel / admin) ────────
router.patch("/bookings/:id/cancel", async (req, res): Promise<void> => {
  const session = req.session as unknown as Record<string, unknown>;
  const userId  = session.userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = CancelBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Booking not found" }); return; }
  // Only the owning customer (or an admin) may cancel via this endpoint.
  if (existing.customerId !== userId && session.isAdmin !== true) {
    res.status(403).json({ error: "Not your booking" }); return;
  }
  // This endpoint is only for calling off a booking that is still searching or
  // scheduled (before a cleaner is engaged). Once accepted/arrived/in-progress
  // the customer must use /customer-cancel; completed/cancelled are terminal.
  // Admins may override at any stage.
  if (session.isAdmin !== true && !["searching", "scheduled"].includes(existing.status)) {
    res.status(409).json({ error: "Booking cannot be cancelled at this stage" }); return;
  }

  // Stop the in-flight search loop so the old request stops re-dispatching.
  cancelRetry(params.data.id);

  await db.update(bookingDispatchesTable).set({ status: "cancelled" }).where(and(eq(bookingDispatchesTable.bookingId, params.data.id), eq(bookingDispatchesTable.status, "pending")));

  const [booking] = await db.update(bookingsTable).set({ status: "cancelled" }).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  res.json(GetBookingResponse.parse(await enrichBooking(booking)));
});

export default router;
