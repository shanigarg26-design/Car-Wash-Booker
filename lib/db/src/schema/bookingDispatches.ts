import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingDispatchesTable = pgTable("booking_dispatches", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  cleanerId: integer("cleaner_id").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingDispatchSchema = createInsertSchema(bookingDispatchesTable).omit({ id: true, createdAt: true });
export type InsertBookingDispatch = z.infer<typeof insertBookingDispatchSchema>;
export type BookingDispatch = typeof bookingDispatchesTable.$inferSelect;
