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
  status: text("status").notNull().default("active"), // active | expired | cancelled
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
