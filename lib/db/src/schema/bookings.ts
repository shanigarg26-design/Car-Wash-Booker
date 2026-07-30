import { pgTable, text, serial, integer, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  cleanerId: integer("cleaner_id"),
  customerAddress: text("customer_address").notNull(),
  customerLat: real("customer_lat"),
  customerLng: real("customer_lng"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("searching"),
  notes: text("notes"),
  vehicleType: text("vehicle_type"),
  cleanType: text("clean_type").default("exterior"),
  priceQuoted: integer("price_quoted").notNull(),
  // Actual amount owed. Equals priceQuoted on a normal finish; a prorated (time-based)
  // amount when the washer has to stop mid-service. Null until the job finishes.
  amountCharged: integer("amount_charged"),
  // When the wash actually started (status → in_progress) — basis for time-proration.
  serviceStartedAt: timestamp("service_started_at", { withTimezone: true }),
  // When the wash finished (completed normally OR stopped early). For history.
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // True when the job was ended early (emergency) — by either party.
  stoppedEarly: boolean("stopped_early").notNull().default(false),
  // Who stopped it early: "customer" | "cleaner" (null if a normal full completion).
  stoppedBy: text("stopped_by"),
  // Set when this booking is covered by a prepaid package (customer owes ₹0).
  subscriptionId: integer("subscription_id"),
  // Set when the washer was nudged that the wash is running over the expected time
  // (prevents repeat nudges).
  overrunNudgedAt: timestamp("overrun_nudged_at", { withTimezone: true }),
  serviceOtp: text("service_otp"),
  otpShared: boolean("otp_shared").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
