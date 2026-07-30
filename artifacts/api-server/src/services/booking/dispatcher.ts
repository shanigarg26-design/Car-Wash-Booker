/**
 * Booking Dispatcher Service
 * Handles the core dispatch engine:
 *   - Finding nearby available cleaners via Haversine distance
 *   - Dispatching push notifications to the 5 nearest cleaners
 *   - Running the 5-minute auto-search / auto-cancel loop
 *
 * This module is intentionally free of Express – it contains pure business logic
 * so it can be moved to a separate process or message queue in the future.
 */
import { db, bookingsTable, usersTable, cleanersTable, bookingDispatchesTable } from "@workspace/db";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import { sendPush } from "../../shared/push.js";

export const MAX_DISPATCH           = 5;
export const MAX_DISPATCH_RADIUS_KM = 5;
export const MAX_SEARCH_DURATION_MS = 5 * 60 * 1000;  // 5 minutes
export const SEARCH_RETRY_INTERVAL  = 10_000;          // retry every 10 s
// A cleaner is only considered truly ONLINE if their app pushed a location/heartbeat
// within this window. The app pushes every ~20 s while online, so a phone that gets
// switched off / loses signal goes "stale" and stops receiving bookings automatically.
export const ONLINE_STALE_MS        = 5 * 60 * 1000;   // 5 minutes
// If a cleaner ACCEPTS a job then goes offline (phone off) before arriving, the booking
// is auto-reassigned once their heartbeat is older than this.
export const ACCEPTED_STALE_MS      = 3 * 60 * 1000;   // 3 minutes

/** Active retry timer per bookingId — used so relocation can cancel old retry loops */
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Cancel the scheduled search-retry loop for a booking (e.g. on relocation). */
export function cancelRetry(bookingId: number): void {
  const t = retryTimers.get(bookingId);
  if (t != null) {
    clearTimeout(t);
    retryTimers.delete(bookingId);
  }
}

/** Haversine great-circle distance in kilometres. */
export function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface DispatchNotificationPayload {
  vehicleType: string | null;
  cleanType:   string | null;
  address:     string;
  price:       number;
}

/**
 * Finds the nearest available + logged-in cleaners within MAX_DISPATCH_RADIUS_KM,
 * inserts dispatch records, and sends push notifications.
 * Returns the number of cleaners dispatched.
 */
export async function dispatchToNearestCleaners(
  bookingId:         number,
  customerLat:       number | null,
  customerLng:       number | null,
  excludeCleanerIds: number[] = [],
  maxCount           = MAX_DISPATCH,
  notification?:     DispatchNotificationPayload,
): Promise<number> {
  const allCleaners = await db
    .select({
      id:        cleanersTable.id,
      userId:    cleanersTable.userId,
      lat:       usersTable.latitude,
      lng:       usersTable.longitude,
      pushToken: usersTable.expoPushToken,
    })
    .from(cleanersTable)
    .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(and(
      eq(cleanersTable.available, true),
      eq(usersTable.isLoggedIn, true),
      // Only cleaners whose app checked in recently — excludes "phantom online"
      // accounts whose phone is off / app was force-quit.
      gte(usersTable.lastSeenAt, new Date(Date.now() - ONLINE_STALE_MS)),
    ));

  // Exclude cleaners who already have a job in progress — no point dispatching to
  // someone who can't accept (they'd just get spammed and the customer would wait).
  const busy = await db
    .select({ cleanerId: bookingsTable.cleanerId })
    .from(bookingsTable)
    .where(inArray(bookingsTable.status, ["accepted", "arrived", "in_progress"]));
  const busyIds = new Set(busy.map(b => b.cleanerId).filter((id): id is number => id != null));

  const eligible = allCleaners.filter(w => !excludeCleanerIds.includes(w.id) && !busyIds.has(w.id));
  if (eligible.length === 0) return 0;

  const withDist = eligible.map(w => ({
    ...w,
    dist:
      customerLat !== null && customerLng !== null && w.lat !== null && w.lng !== null
        ? haversineKm(customerLat, customerLng, w.lat!, w.lng!)
        : 999_999,
  }));

  const nearby = withDist
    .filter(w => w.dist <= MAX_DISPATCH_RADIUS_KM)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, maxCount);

  if (nearby.length === 0) return 0;

  await db
    .insert(bookingDispatchesTable)
    .values(nearby.map(w => ({ bookingId, cleanerId: w.id, status: "pending" })))
    .onConflictDoNothing();

  if (notification) {
    const tokens = nearby.map(w => w.pushToken).filter(Boolean) as string[];
    const { vehicleType, cleanType, address, price } = notification;
    const cleanLabel   = cleanType === "both" ? "Full (Ext + Int)" : "Exterior";
    const vehicleLabel = vehicleType ?? "Vehicle";
    await sendPush(
      tokens,
      "🚗 New Booking Near You!",
      `${vehicleLabel} · ${cleanLabel} clean · ₹${price}\n📍 ${address}`,
      { type: "new_booking", bookingId },
    );
  }

  return nearby.length;
}

/** Backward-compat alias */
export const dispatchToNearestWashers = dispatchToNearestCleaners;

/**
 * Starts the recursive 5-minute search loop.
 * Every 30 s it retries dispatching to new cleaners (excluding ones already tried).
 * After 5 min it auto-cancels the booking if still in "searching" state.
 */
export function scheduleSearchRetry(
  bookingId:   number,
  customerLat: number | null,
  customerLng: number | null,
  vehicleType: string | null,
  cleanType:   string,
  address:     string,
  price:       number,
  startedAt:   number,
): void {
  const elapsed = Date.now() - startedAt;

  if (elapsed >= MAX_SEARCH_DURATION_MS) {
    db.update(bookingsTable)
      .set({ status: "cancelled" })
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.status, "searching")))
      .then(() => console.log(`[Dispatch] Booking ${bookingId} auto-cancelled after 5 min`))
      .catch(() => {});
    return;
  }

  const timer = setTimeout(async () => {
    retryTimers.delete(bookingId);
    try {
      const [booking] = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.id, bookingId));

      if (!booking || booking.status !== "searching") return;

      const dispatches = await db
        .select({ cleanerId: bookingDispatchesTable.cleanerId })
        .from(bookingDispatchesTable)
        .where(eq(bookingDispatchesTable.bookingId, bookingId));

      const dispatched = await dispatchToNearestCleaners(
        bookingId, customerLat, customerLng,
        dispatches.map(d => d.cleanerId),
        MAX_DISPATCH,
        { vehicleType, cleanType, address, price },
      );

      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[Dispatch] Booking ${bookingId} retry at ${elapsedSec}s: +${dispatched} cleaner(s)`);

      scheduleSearchRetry(
        bookingId, customerLat, customerLng,
        vehicleType, cleanType, address, price, startedAt,
      );
    } catch (err) {
      console.error(`[Dispatch] Retry error for booking ${bookingId}:`, err);
    }
  }, SEARCH_RETRY_INTERVAL);

  retryTimers.set(bookingId, timer);
}

/**
 * Self-healing sweep — meant to be called periodically by an external cron
 * (GitHub Actions) so it works even though Render's free tier sleeps and drops
 * in-process timers. Handles the "someone's phone switched off" cases:
 *
 *  1. `searching` bookings that have exceeded the max search window are cancelled
 *     (backup for the in-process 5-min timer, which is lost when the dyno sleeps).
 *  2. `accepted` bookings whose assigned cleaner went offline (stale heartbeat)
 *     before arriving are reset to `searching` and re-dispatched to other cleaners,
 *     so the customer isn't stranded waiting for a cleaner who vanished.
 *
 * Returns a summary for logging/observability.
 */
export async function sweepStaleBookings(): Promise<{ cancelledSearching: number; reassigned: number; reassignFailed: number }> {
  const now = Date.now();
  let cancelledSearching = 0, reassigned = 0, reassignFailed = 0;

  // 1) Expire overdue "searching" bookings
  const staleSearching = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.status, "searching"), lt(bookingsTable.createdAt, new Date(now - MAX_SEARCH_DURATION_MS))),
  );
  for (const b of staleSearching) {
    cancelRetry(b.id);
    await db.update(bookingDispatchesTable).set({ status: "cancelled" })
      .where(and(eq(bookingDispatchesTable.bookingId, b.id), eq(bookingDispatchesTable.status, "pending")));
    await db.update(bookingsTable).set({ status: "cancelled" })
      .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "searching")));
    cancelledSearching++;
    console.log(`[Sweep] Booking ${b.id} cancelled — no cleaner found in time`);
  }

  // 2) Reassign "accepted" bookings whose cleaner went offline before arriving
  const accepted = await db.select().from(bookingsTable).where(eq(bookingsTable.status, "accepted"));
  const staleCutoff = new Date(now - ACCEPTED_STALE_MS);
  for (const b of accepted) {
    if (!b.cleanerId) continue;
    const [cu] = await db
      .select({ lastSeenAt: usersTable.lastSeenAt, pushToken: usersTable.expoPushToken })
      .from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
      .where(eq(cleanersTable.id, b.cleanerId));
    // Fresh heartbeat → cleaner is genuinely en route; leave it alone.
    if (cu?.lastSeenAt && cu.lastSeenAt >= staleCutoff) continue;

    // Cleaner vanished — free the booking and search again.
    await db.update(bookingDispatchesTable).set({ status: "cleaner_cancelled" })
      .where(and(eq(bookingDispatchesTable.bookingId, b.id), eq(bookingDispatchesTable.cleanerId, b.cleanerId)));
    await db.update(bookingsTable)
      .set({ status: "searching", cleanerId: null, serviceOtp: null, otpShared: false })
      .where(eq(bookingsTable.id, b.id));

    const tried = await db.select({ cleanerId: bookingDispatchesTable.cleanerId })
      .from(bookingDispatchesTable).where(eq(bookingDispatchesTable.bookingId, b.id));
    const count = await dispatchToNearestCleaners(
      b.id, b.customerLat, b.customerLng, tried.map(d => d.cleanerId), MAX_DISPATCH,
      { vehicleType: b.vehicleType, cleanType: b.cleanType ?? "exterior", address: b.customerAddress, price: b.priceQuoted },
    );
    scheduleSearchRetry(b.id, b.customerLat, b.customerLng, b.vehicleType, b.cleanType ?? "exterior", b.customerAddress, b.priceQuoted, now);
    if (count > 0) reassigned++; else reassignFailed++;
    console.log(`[Sweep] Booking ${b.id} reassigned — cleaner ${b.cleanerId} went offline; re-dispatched to ${count}`);

    // Let the customer know we're finding a new cleaner.
    const [customer] = await db.select({ pushToken: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, b.customerId));
    if (customer?.pushToken) {
      await sendPush([customer.pushToken], "🔄 Finding you a new cleaner",
        "Your previous cleaner became unavailable. We're matching you with someone else nearby.",
        { type: "booking_reassigned", bookingId: b.id });
    }
  }

  return { cancelledSearching, reassigned, reassignFailed };
}
