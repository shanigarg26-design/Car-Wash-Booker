/**
 * Booking Service – HTTP Router
 * Thin Express layer. All business logic lives in service.ts; dispatch
 * engine lives in dispatcher.ts. This file only handles HTTP concerns
 * (parsing IDs, calling service functions, returning responses).
 */
import { Router, type IRouter } from "express";
import { db, bookingsTable, usersTable, cleanersTable, bookingDispatchesTable } from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
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
import { enrichBooking, calcPrice, generateServiceOtp } from "./service.js";
import { dispatchToNearestCleaners, scheduleSearchRetry, cancelRetry, MAX_DISPATCH, MAX_DISPATCH_RADIUS_KM, haversineKm } from "./dispatcher.js";
import { sendPush } from "../../shared/push.js";

const router: IRouter = Router();

// ── GET /api/bookings ─────────────────────────────────────────────────────────
router.get("/bookings", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const role = req.query.role as string | undefined;
  let bookings: (typeof bookingsTable.$inferSelect)[] = [];

  if (role === "cleaner") {
    const [cleaner] = await db.select().from(cleanersTable).where(eq(cleanersTable.userId, userId));
    if (!cleaner) { res.json([]); return; }

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

  const { customerAddress, customerLat, customerLng, notes, vehicleType, washType } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const lat            = customerLat ?? user.latitude ?? null;
  const lng            = customerLng ?? user.longitude ?? null;
  const price          = calcPrice(vehicleType, washType);
  const cleanTypeFinal = washType ?? "exterior";

  const [booking] = await db.insert(bookingsTable).values({
    customerId: userId, cleanerId: null, customerAddress,
    customerLat: lat, customerLng: lng, scheduledAt: new Date(),
    notes: notes ?? null, vehicleType: vehicleType ?? null,
    cleanType: cleanTypeFinal, priceQuoted: price, status: "searching",
  }).returning();

  await dispatchToNearestCleaners(booking.id, lat, lng, [], MAX_DISPATCH, {
    vehicleType: vehicleType ?? null, cleanType: cleanTypeFinal, address: customerAddress, price,
  });

  scheduleSearchRetry(booking.id, lat, lng, vehicleType ?? null, cleanTypeFinal, customerAddress, price, Date.now());

  const enriched = await enrichBooking(booking);
  res.status(201).json(GetBookingResponse.parse(enriched));
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
  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

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

  const [dispatch] = await db.select().from(bookingDispatchesTable).where(
    and(eq(bookingDispatchesTable.bookingId, params.data.id), eq(bookingDispatchesTable.cleanerId, cleaner.id), eq(bookingDispatchesTable.status, "pending"))
  );
  if (!dispatch) { res.status(403).json({ error: "Not dispatched to you or already handled" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, params.data.id));
  if (!booking || booking.status !== "searching") { res.status(409).json({ error: "Booking already taken or not available" }); return; }

  await db.update(bookingDispatchesTable).set({ status: "accepted" }).where(eq(bookingDispatchesTable.id, dispatch.id));
  await db.update(bookingDispatchesTable).set({ status: "cancelled" }).where(
    and(eq(bookingDispatchesTable.bookingId, params.data.id), ne(bookingDispatchesTable.id, dispatch.id), eq(bookingDispatchesTable.status, "pending"))
  );

  const otp       = generateServiceOtp();
  const [updated] = await db.update(bookingsTable).set({ status: "accepted", cleanerId: cleaner.id, serviceOtp: otp }).where(eq(bookingsTable.id, params.data.id)).returning();
  const enriched  = await enrichBooking(updated);

  if (enriched._customerPushToken) {
    await sendPush([enriched._customerPushToken], "🧹 Cleaner Accepted Your Booking!", `${enriched.cleanerName} is on the way. Get ready!`, { type: "booking_accepted", bookingId: updated.id });
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
  if (booking.serviceOtp !== otp.trim()) { res.status(400).json({ error: "incorrect_otp", message: "Incorrect OTP. Please try again." }); return; }

  const [updated] = await db.update(bookingsTable).set({ status: "in_progress" }).where(eq(bookingsTable.id, bookingId)).returning();
  const enriched  = await enrichBooking(updated);

  if (enriched._customerPushToken) {
    await sendPush([enriched._customerPushToken], "🧽 Clean Started!", `${enriched.cleanerName} has started cleaning your car.`, { type: "clean_started", bookingId });
  }

  res.json(GetBookingResponse.parse(enriched));
});

// ── PATCH /api/bookings/:id/complete ─────────────────────────────────────────
router.patch("/bookings/:id/complete", async (req, res): Promise<void> => {
  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = CompleteBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [booking] = await db.update(bookingsTable).set({ status: "completed" }).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  if (booking.cleanerId) {
    const [c] = await db.select().from(cleanersTable).where(eq(cleanersTable.id, booking.cleanerId));
    if (c) await db.update(cleanersTable).set({ totalCleans: c.totalCleans + 1 }).where(eq(cleanersTable.id, c.id));
  }

  res.json(GetBookingResponse.parse(await enrichBooking(booking)));
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

// ── PATCH /api/bookings/:id/cancel (admin/legacy) ────────────────────────────
router.patch("/bookings/:id/cancel", async (req, res): Promise<void> => {
  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = CancelBookingParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  await db.update(bookingDispatchesTable).set({ status: "cancelled" }).where(and(eq(bookingDispatchesTable.bookingId, params.data.id), eq(bookingDispatchesTable.status, "pending")));

  const [booking] = await db.update(bookingsTable).set({ status: "cancelled" }).where(eq(bookingsTable.id, params.data.id)).returning();
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }

  res.json(GetBookingResponse.parse(await enrichBooking(booking)));
});

export default router;
