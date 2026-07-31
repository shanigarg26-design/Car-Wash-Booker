import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * A prepaid car-wash package a customer buys. Longer packages carry a bigger
 * discount to reward commitment. Grants `washesTotal` washes to redeem over the
 * duration; each covered booking increments `washesUsed`.
 */
export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  packageKey: text("package_key").notNull(),
  vehicleType: text("vehicle_type").notNull(),
  cleanType: text("clean_type").notNull().default("exterior"),
  washesTotal: integer("washes_total").notNull(),
  washesUsed: integer("washes_used").notNull().default(0),
  discountPercent: integer("discount_percent").notNull(),
  pricePaid: integer("price_paid").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("active"), // active | expired | cancelled | pending_assignment | unassigned
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Postpaid "daily" packages (same washer every day, billed weekly offline) ──
  // kind: "prepaid" = legacy pay-upfront wash-credit bucket; "daily" = new model.
  kind: text("kind").notNull().default("prepaid"),
  // The washer bound to this package once someone accepts it. Same washer every day.
  cleanerId: integer("cleaner_id"),
  // Owner may request a specific washer (e.g. re-book last one); if he rejects, the
  // owner is told to auto-assign or pick another.
  preferredCleanerId: integer("preferred_cleaner_id"),
  // Daily wash time as minutes from midnight IST (e.g. 540 = 09:00). Same every day.
  dailyMinutes: integer("daily_minutes"),
  // Per-wash price = the assigned washer's rate; drives the weekly bill.
  pricePerWash: integer("price_per_wash"),
  // Delivery address (same every day) captured at creation.
  address: text("address"),
  latitude: text("latitude"),
  longitude: text("longitude"),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
