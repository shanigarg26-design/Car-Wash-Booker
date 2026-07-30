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
  // True when the washer ended the job early (e.g. an emergency).
  stoppedEarly: boolean("stopped_early").notNull().default(false),
  // Set when this booking is covered by a prepaid package (customer owes ₹0).
  subscriptionId: integer("subscription_id"),
  serviceOtp: text("service_otp"),
  otpShared: boolean("otp_shared").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
