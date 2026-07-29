/**
 * Booking Service – Business Logic
 * Handles pricing, OTP generation, and enriching raw booking DB rows
 * with joined customer/cleaner data ready for API responses.
 *
 * Keep HTTP concerns (Request/Response) OUT of this file.
 */
import { db, bookingsTable, usersTable, cleanersTable, bookingDispatchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ── Pricing table (₹ INR) ────────────────────────────────────────────────────
export const PRICING: Record<string, { exterior: number; both: number }> = {
  "Small Hatchback":   { exterior: 120, both: 220 },
  "Premium Hatchback": { exterior: 140, both: 260 },
  "Compact Sedan":     { exterior: 160, both: 300 },
  "Premium Sedan":     { exterior: 180, both: 320 },
  "Compact SUV":       { exterior: 200, both: 350 },
  "Mid-Size SUV":      { exterior: 230, both: 400 },
  "Large SUV":         { exterior: 280, both: 500 },
  "Luxury":            { exterior: 350, both: 700 },
};

/** Returns the quoted price (₹) for a vehicle + clean type combination. */
export function calcPrice(
  vehicleType: string | null | undefined,
  cleanType:   string | null | undefined,
): number {
  const row = vehicleType ? PRICING[vehicleType] : undefined;
  if (!row) return 200;
  return cleanType === "both" ? row.both : row.exterior;
}

/** Generates a 4-digit numeric OTP string. */
export function generateServiceOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000));
}

/**
 * Enriches a raw booking DB row with joined customer + cleaner data.
 * Returns a rich object ready to be serialised as an API response.
 * Also includes internal "_" prefixed fields used for push notifications.
 */
export async function enrichBooking(booking: typeof bookingsTable.$inferSelect) {
  const [customer] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, booking.customerId));

  let cleanerName:      string | null = null;
  let cleanerPhone:     string | null = null;
  let cleanerLat:       number | null = null;
  let cleanerLng:       number | null = null;
  let cleanerPushToken: string | null = null;
  let cleanerUserId:    number | null = null;
  let cleanerAvatar:    string | null = null;

  if (booking.cleanerId) {
    const [cu] = await db
      .select({
        name:      usersTable.name,
        phone:     usersTable.phone,
        lat:       usersTable.latitude,
        lng:       usersTable.longitude,
        pushToken: usersTable.expoPushToken,
        userId:    usersTable.id,
        avatarUrl: usersTable.avatarUrl,
      })
      .from(cleanersTable)
      .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
      .where(eq(cleanersTable.id, booking.cleanerId));

    cleanerName      = cu?.name      ?? null;
    cleanerPhone     = cu?.phone     ?? null;
    cleanerLat       = cu?.lat       ?? null;
    cleanerLng       = cu?.lng       ?? null;
    cleanerPushToken = cu?.pushToken ?? null;
    cleanerUserId    = cu?.userId    ?? null;
    cleanerAvatar    = cu?.avatarUrl ?? null;
  }

  const dispatches = await db
    .select()
    .from(bookingDispatchesTable)
    .where(eq(bookingDispatchesTable.bookingId, booking.id));

  return {
    id:                        booking.id,
    customerId:                booking.customerId,
    cleanerId:                 booking.cleanerId ?? null,
    washerId:                  booking.cleanerId ?? null,
    customerName:              customer?.name  ?? "Unknown",
    customerPhone:             customer?.phone ?? null,
    customerAvatar:            customer?.avatarUrl ?? null,
    cleanerName,
    cleanerPhone,
    cleanerAvatar,
    washerName:                cleanerName,
    washerPhone:               cleanerPhone,
    washerAvatar:              cleanerAvatar,
    customerAddress:           booking.customerAddress,
    customerLat:               booking.customerLat ?? null,
    customerLng:               booking.customerLng ?? null,
    cleanerLat,
    cleanerLng,
    washerLat:                 cleanerLat,
    washerLng:                 cleanerLng,
    scheduledAt:               booking.scheduledAt.toISOString(),
    status:                    booking.status,
    notes:                     booking.notes,
    vehicleType:               booking.vehicleType ?? null,
    cleanType:                 booking.cleanType ?? "exterior",
    washType:                  booking.cleanType ?? "exterior",
    priceQuoted:               booking.priceQuoted,
    serviceOtp:                booking.serviceOtp ?? null,
    otpShared:                 booking.otpShared  ?? false,
    createdAt:                 booking.createdAt.toISOString(),
    dispatchedCount:           dispatches.length,
    washerCancelledPreviously: dispatches.some(d => d.status === "declined"),
    // Internal – used for push notifications; stripped by Zod schema before client delivery
    _customerPushToken: customer?.expoPushToken ?? null,
    _cleanerPushToken:  cleanerPushToken,
    _washerPushToken:   cleanerPushToken,
    _cleanerUserId:     cleanerUserId,
    _washerUserId:      cleanerUserId,
  };
}
