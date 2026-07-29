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
  serviceOtp: text("service_otp"),
  otpShared: boolean("otp_shared").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
