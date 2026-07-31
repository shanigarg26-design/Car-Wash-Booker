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
import { db, bookingsTable, usersTable, cleanersTable, bookingDispatchesTable, subscriptionsTable } from "@workspace/db";
import { eq, and, gte, lt, lte, inArray, isNull } from "drizzle-orm";
import { sendPush } from "../../shared/push.js";
import { expectedDurationMin, generateServiceOtp } from "./service.js";

export const MAX_DISPATCH           = 5;
export const MAX_DISPATCH_RADIUS_KM = 5;
export const MAX_SEARCH_DURATION_MS = 5 * 60 * 1000;  // 5 minutes
export const SEARCH_RETRY_INTERVAL  = 10_000;          // retry every 10 s
// A cleaner is only considered truly ONLINE if their app pushed a location/heartbeat
// within this window. The app pushes every ~20 s while online, so a phone that gets
// switched off / loses signal goes "stale" and stops receiving bookings automatically.
export const ONLINE_STALE_MS        = 5 * 60 * 1000;   // 5 minutes
export const SCHEDULED_BUFFER_MS    = 30 * 60 * 1000;  // no new jobs within 30 min of a scheduled one

// Current half-hour slot index in IST (India). 0 = 06:00, 1 = 06:30 … 23 = 17:30.
// Returns -1 outside the 06:00–18:00 window. Slots are stored per cleaner as a JSON
// array of these indices; an empty/unset schedule means "available all day".
export function currentIstSlot(at: Date = new Date()): number {
  const istMs = at.getTime() + 5.5 * 60 * 60 * 1000; // shift UTC → IST
  const d = new Date(istMs);
  const h = d.getUTCHours(), m = d.getUTCMinutes();
  if (h < 6 || h >= 18) return -1;
  return (h - 6) * 2 + (m >= 30 ? 1 : 0);
}

function worksThisSlot(availableSlots: string | null, slot: number): boolean {
  // A washer with slots set only matches those slots. A washer who hasn't set any is
  // treated as available all day, so he never stops getting scheduled bookings — the
  // toggle only gates ad-hoc/instant work, never scheduled.
  if (slot < 0) return false;
  if (!availableSlots) return true;
  try {
    const arr = JSON.parse(availableSlots);
    if (!Array.isArray(arr) || arr.length === 0) return true;
    return arr.includes(slot);
  } catch { return true; }
}

/** Send a booking to exactly ONE cleaner (used when the owner requests a specific washer). */
export async function dispatchToSpecificCleaner(
  bookingId: number, cleanerId: number,
  notification: { vehicleType: string | null; cleanType: string; address: string; price: number },
): Promise<void> {
  await db.insert(bookingDispatchesTable).values({ bookingId, cleanerId, status: "pending" }).onConflictDoNothing();
  const [row] = await db.select({ token: usersTable.expoPushToken })
    .from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(eq(cleanersTable.id, cleanerId));
  if (row?.token) {
    const cleanLabel = notification.cleanType === "both" ? "Full (Ext + Int)" : "Exterior";
    await sendPush([row.token], "🚗 Daily Package Request",
      `${notification.vehicleType ?? "Vehicle"} · ${cleanLabel} · ₹${notification.price}\n📍 ${notification.address}`,
      { type: "package_request", bookingId });
  }
}

/**
 * A requested (preferred) washer didn't take the day (declined, timed out, or is
 * busy that slot). We don't ask the owner to pick another — we drop the preference
 * and search GENERICALLY: broadcast the day to any available washer whose slot fits
 * (online or offline). The search window is reset so the generic search gets a fresh
 * 5 minutes. If the owner wants a different washer, they cancel and start a new package.
 */
export async function fallbackPreferredToGeneric(
  pkg: { id: number; customerId: number }, bookingId: number,
): Promise<void> {
  await db.update(subscriptionsTable).set({ preferredCleanerId: null }).where(eq(subscriptionsTable.id, pkg.id));
  await db.update(bookingDispatchesTable).set({ status: "cancelled" })
    .where(and(eq(bookingDispatchesTable.bookingId, bookingId), eq(bookingDispatchesTable.status, "pending")));

  const [bk] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!bk) return;
  // Reset scheduledAt to now so the generic search gets a full window (the sweep measures
  // the search timeout from scheduledAt) and dispatch matches washers free at this time.
  await db.update(bookingsTable).set({ status: "searching", cleanerId: null, scheduledAt: new Date() })
    .where(eq(bookingsTable.id, bookingId));

  const tried = await db.select({ cleanerId: bookingDispatchesTable.cleanerId }).from(bookingDispatchesTable).where(eq(bookingDispatchesTable.bookingId, bookingId));
  await dispatchToNearestCleaners(bookingId, bk.customerLat, bk.customerLng, tried.map(d => d.cleanerId), MAX_DISPATCH,
    { vehicleType: bk.vehicleType, cleanType: bk.cleanType ?? "exterior", address: bk.customerAddress, price: bk.priceQuoted }, true);
  scheduleSearchRetry(bookingId, bk.customerLat, bk.customerLng, bk.vehicleType, bk.cleanType ?? "exterior", bk.customerAddress, bk.priceQuoted, Date.now(), true);

  const [cust] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, pkg.customerId));
  if (cust?.token) {
    await sendPush([cust.token], "Finding your washer",
      "Your requested washer didn't take today's wash — we're finding any available washer nearby.",
      { type: "package_generic_search", subscriptionId: pkg.id });
  }
}
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
  // Scheduled/package bookings reach washers whose SLOT is marked available for that
  // time even if their live online toggle is OFF — they said they work that slot, so
  // the request should still find them (they get a push and can open the app). Instant
  // bookings keep requiring the washer to be online right now.
  includeOffline     = false,
): Promise<number> {
  // Online gating applies only to instant bookings.
  const onlineConds = includeOffline ? [] : [
    eq(cleanersTable.available, true),
    eq(usersTable.isLoggedIn, true),
    // Only cleaners whose app checked in recently — excludes "phantom online"
    // accounts whose phone is off / app was force-quit.
    gte(usersTable.lastSeenAt, new Date(Date.now() - ONLINE_STALE_MS)),
  ];
  const allCleaners = await db
    .select({
      id:        cleanersTable.id,
      userId:    cleanersTable.userId,
      lat:       usersTable.latitude,
      lng:       usersTable.longitude,
      pushToken: usersTable.expoPushToken,
      slots:     cleanersTable.availableSlots,
    })
    .from(cleanersTable)
    .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(onlineConds.length ? and(...onlineConds) : undefined);

  // Exclude cleaners who already have a job in progress — no point dispatching to
  // someone who can't accept (they'd just get spammed and the customer would wait).
  const busy = await db
    .select({ cleanerId: bookingsTable.cleanerId })
    .from(bookingsTable)
    .where(inArray(bookingsTable.status, ["accepted", "arrived", "in_progress"]));
  const busyIds = new Set(busy.map(b => b.cleanerId).filter((id): id is number => id != null));

  // Cleaners with a scheduled/assigned booking starting within the next 30 min must be
  // left free for it — don't dispatch a new job that would overrun into it.
  const now = new Date();
  const soon = await db
    .select({ cleanerId: bookingsTable.cleanerId })
    .from(bookingsTable)
    .where(and(
      inArray(bookingsTable.status, ["scheduled", "accepted", "arrived"]),
      gte(bookingsTable.scheduledAt, now),
      lte(bookingsTable.scheduledAt, new Date(now.getTime() + SCHEDULED_BUFFER_MS)),
    ));
  const bufferedIds = new Set(soon.map(b => b.cleanerId).filter((id): id is number => id != null));

  const slot = currentIstSlot(now);
  const eligible = allCleaners.filter(w =>
    !excludeCleanerIds.includes(w.id) &&
    !busyIds.has(w.id) &&
    !bufferedIds.has(w.id) &&
    worksThisSlot(w.slots, slot),   // respect the cleaner's chosen working hours
  );
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
  includeOffline = false,
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
        includeOffline,
      );

      const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[Dispatch] Booking ${bookingId} retry at ${elapsedSec}s: +${dispatched} cleaner(s)`);

      scheduleSearchRetry(
        bookingId, customerLat, customerLng,
        vehicleType, cleanType, address, price, startedAt, includeOffline,
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
export async function sweepStaleBookings(): Promise<{ cancelledSearching: number; reassigned: number; reassignFailed: number; promotedScheduled: number; nudgedOverrun: number }> {
  const now = Date.now();
  let cancelledSearching = 0, reassigned = 0, reassignFailed = 0, promotedScheduled = 0;

  // 0) Promote SCHEDULED bookings whose time has arrived → start searching + dispatch.
  const dueScheduled = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.status, "scheduled"), lte(bookingsTable.scheduledAt, new Date())),
  );
  for (const b of dueScheduled) {
    // ── Daily-package days ──────────────────────────────────────────────────
    if (b.subscriptionId) {
      const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, b.subscriptionId));
      // Package gone/cancelled → drop the day quietly.
      if (!pkg || pkg.status !== "active") {
        await db.update(bookingsTable).set({ status: "cancelled" })
          .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "scheduled")));
        continue;
      }
      // Washer already bound → assign this day straight to him (no re-dispatch;
      // same washer every day). He goes → arrives → OTP → starts, like any job.
      if (pkg.cleanerId != null) {
        // Don't hand him a second live job — if he's still mid-wash, leave this day
        // 'scheduled' and retry on the next sweep once he's free (prevents double-booking).
        const [busyBound] = await db.select({ id: bookingsTable.id }).from(bookingsTable)
          .where(and(eq(bookingsTable.cleanerId, pkg.cleanerId), inArray(bookingsTable.status, ["accepted", "arrived", "in_progress"])));
        if (busyBound) continue;
        const otp = generateServiceOtp();
        const [assigned] = await db.update(bookingsTable)
          .set({ status: "accepted", cleanerId: pkg.cleanerId, serviceOtp: otp, priceQuoted: pkg.pricePerWash ?? b.priceQuoted })
          .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "scheduled"))).returning();
        if (assigned) {
          await db.insert(bookingDispatchesTable)
            .values({ bookingId: b.id, cleanerId: pkg.cleanerId, status: "accepted" })
            .onConflictDoNothing();
          const [u] = await db.select({ token: usersTable.expoPushToken }).from(usersTable)
            .leftJoin(cleanersTable, eq(cleanersTable.userId, usersTable.id))
            .where(eq(cleanersTable.id, pkg.cleanerId));
          if (u?.token) {
            await sendPush([u.token], "🗓️ Today's Package Wash", `Head to ${b.customerAddress} for your daily wash.`, { type: "package_day", bookingId: b.id });
          }
          // Tell the OWNER his wash is starting today so he's ready to share the OTP.
          const [cust] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, b.customerId));
          if (cust?.token) {
            await sendPush([cust.token], "🚗 Today's wash is on", "Your daily-package washer is assigned for today. Open the app to share your OTP when he arrives.", { type: "package_day_customer", bookingId: b.id });
          }
          promotedScheduled++;
          console.log(`[Sweep] Package booking ${b.id} assigned to bound washer ${pkg.cleanerId}`);
        }
        continue;
      }
      // Assignment day, not bound yet.
      if (pkg.preferredCleanerId != null) {
        // Owner requested a specific previous washer → send ONLY to him (no broadcast).
        // Scheduled requests reach him by his SLOT, not his online toggle: send it even
        // if he's toggled off, as long as the slot is his and he's not already busy.
        // He then accepts or rejects.
        const [pref] = await db.select({ slots: cleanersTable.availableSlots })
          .from(cleanersTable).where(eq(cleanersTable.id, pkg.preferredCleanerId));
        const bookingSlot = currentIstSlot(b.scheduledAt);
        const slotOk = worksThisSlot(pref?.slots ?? null, bookingSlot);
        const [busyPref] = await db.select({ id: bookingsTable.id }).from(bookingsTable)
          .where(and(eq(bookingsTable.cleanerId, pkg.preferredCleanerId), inArray(bookingsTable.status, ["accepted", "arrived", "in_progress"])));
        if (slotOk && !busyPref) {
          // Reset scheduledAt to now so the 5-min search window is measured from when it
          // actually starts searching (a late cron would otherwise cancel it immediately).
          const [promoted] = await db.update(bookingsTable).set({ status: "searching", scheduledAt: new Date() })
            .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "scheduled"))).returning();
          if (promoted) {
            await dispatchToSpecificCleaner(b.id, pkg.preferredCleanerId,
              { vehicleType: b.vehicleType, cleanType: b.cleanType ?? "exterior", address: b.customerAddress, price: b.priceQuoted });
            promotedScheduled++;
            console.log(`[Sweep] Package ${pkg.id} day ${b.id} sent to requested washer ${pkg.preferredCleanerId}`);
          }
        } else {
          // He's not free for that slot (already booked) → search generically instead.
          await fallbackPreferredToGeneric(pkg, b.id);
        }
        continue;
      }
      // Not bound and no preferred → fall through to normal broadcast; the first washer
      // to accept binds the whole package (handled in the accept endpoint).
    }

    // Reset scheduledAt to now so the search window starts at promotion (a late cron
    // otherwise cancels the booking in the same run — see the stale-search sweep below).
    const [promoted] = await db.update(bookingsTable).set({ status: "searching", scheduledAt: new Date() })
      .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "scheduled"))).returning();
    if (!promoted) continue;
    // Scheduled bookings reach in-range washers whose slot is marked available even if
    // their toggle is off (includeOffline). The online toggle only gates instant bookings.
    await dispatchToNearestCleaners(b.id, b.customerLat, b.customerLng, [], MAX_DISPATCH,
      { vehicleType: b.vehicleType, cleanType: b.cleanType ?? "exterior", address: b.customerAddress, price: b.priceQuoted }, true);
    scheduleSearchRetry(b.id, b.customerLat, b.customerLng, b.vehicleType, b.cleanType ?? "exterior", b.customerAddress, b.priceQuoted, now, true);
    promotedScheduled++;
    console.log(`[Sweep] Scheduled booking ${b.id} promoted to searching`);
  }

  // 1) Expire overdue "searching" bookings
  // Measure the search window from scheduledAt, not createdAt: a scheduled/package day
  // is created long before it starts searching (at its scheduled time), so createdAt
  // would make it look stale the instant it's promoted. For instant bookings
  // scheduledAt == creation time, so behaviour is unchanged.
  const staleSearching = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.status, "searching"), lt(bookingsTable.scheduledAt, new Date(now - MAX_SEARCH_DURATION_MS))),
  );
  for (const b of staleSearching) {
    cancelRetry(b.id);
    if (b.subscriptionId) {
      const [pkg] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, b.subscriptionId));
      if (pkg && pkg.status === "active") {
        // A requested-washer day that wasn't accepted in its 5-min window → fall back to
        // a generic search (any available washer) instead of losing the day.
        if (pkg.cleanerId == null && pkg.preferredCleanerId != null) {
          await fallbackPreferredToGeneric(pkg, b.id);
          continue;
        }
        // A generic package day that found NO washer → drop this day but add a make-up
        // day at the end so the owner still gets the full number of washes.
        await db.update(bookingDispatchesTable).set({ status: "cancelled" })
          .where(and(eq(bookingDispatchesTable.bookingId, b.id), eq(bookingDispatchesTable.status, "pending")));
        await db.update(bookingsTable).set({ status: "cancelled", cleanerId: null, notes: "no_washer" })
          .where(and(eq(bookingsTable.id, b.id), eq(bookingsTable.status, "searching")));
        const nextDay = new Date(pkg.expiresAt.getTime() + 86_400_000);
        await db.insert(bookingsTable).values({
          customerId: pkg.customerId, cleanerId: pkg.cleanerId ?? null,
          customerAddress: pkg.address ?? b.customerAddress,
          customerLat: pkg.latitude != null ? Number(pkg.latitude) : b.customerLat,
          customerLng: pkg.longitude != null ? Number(pkg.longitude) : b.customerLng,
          scheduledAt: nextDay, status: "scheduled",
          vehicleType: pkg.vehicleType || null, cleanType: pkg.cleanType,
          priceQuoted: pkg.pricePerWash ?? 0, subscriptionId: pkg.id,
        });
        await db.update(subscriptionsTable).set({ expiresAt: nextDay, washesTotal: pkg.washesTotal + 1 })
          .where(eq(subscriptionsTable.id, pkg.id));
        const [cust] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, pkg.customerId));
        if (cust?.token) await sendPush([cust.token], "No washer today", "No washer was available for today's package wash — we added a make-up day at the end.", { type: "package_no_washer", subscriptionId: pkg.id });
        cancelledSearching++;
        continue;
      }
    }
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
    // Daily-package days stay with their bound washer — never reassign to someone
    // else. If he doesn't show, the owner marks a no-show (which extends the package).
    if (b.subscriptionId) continue;
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

  // 3) Nudge washers whose in-progress wash is running OVER the expected time
  //    (30 min exterior / 45 min full). One nudge per booking (overrunNudgedAt guards).
  let nudgedOverrun = 0;
  const running = await db.select().from(bookingsTable).where(
    and(eq(bookingsTable.status, "in_progress"), isNull(bookingsTable.overrunNudgedAt)),
  );
  for (const b of running) {
    if (!b.serviceStartedAt || !b.cleanerId) continue;
    const expMin = expectedDurationMin(b.cleanType);
    const elapsedMin = (now - b.serviceStartedAt.getTime()) / 60000;
    if (elapsedMin < expMin) continue;

    const [cu] = await db
      .select({ token: usersTable.expoPushToken })
      .from(cleanersTable).leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
      .where(eq(cleanersTable.id, b.cleanerId));
    if (cu?.token) {
      await sendPush([cu.token], "⏱️ Wash running over time",
        `This wash has passed the expected ${expMin} min. Please wrap up soon or let the customer know.`,
        { type: "wash_overrun", bookingId: b.id });
    }
    await db.update(bookingsTable).set({ overrunNudgedAt: new Date() }).where(eq(bookingsTable.id, b.id));
    nudgedOverrun++;
    console.log(`[Sweep] Booking ${b.id} overrun nudge sent (${Math.round(elapsedMin)} min > ${expMin} min)`);
  }

  return { cancelledSearching, reassigned, reassignFailed, promotedScheduled, nudgedOverrun };
}
