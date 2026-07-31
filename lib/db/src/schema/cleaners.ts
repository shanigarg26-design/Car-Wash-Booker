import { pgTable, text, serial, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cleanersTable = pgTable("cleaners", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().unique(),
  phone: text("phone"),
  bio: text("bio"),
  pricePerClean: integer("price_per_clean").notNull().default(500),
  available: boolean("available").notNull().default(true),
  // JSON array of selected half-hour slot indices (0 = 06:00 IST … 23 = 17:30 IST).
  // null/empty = no schedule set yet → treated as available all day (backward compatible).
  availableSlots: text("available_slots"),
  rating: real("rating"),
  totalCleans: integer("total_cleans").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCleanerSchema = createInsertSchema(cleanersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCleaner = z.infer<typeof insertCleanerSchema>;
export type Cleaner = typeof cleanersTable.$inferSelect;
