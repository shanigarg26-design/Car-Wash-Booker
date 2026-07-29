import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const carwashOwnersTable = pgTable("carwash_owners", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  businessName: text("business_name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  phone: text("phone"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCarwashOwnerSchema = createInsertSchema(carwashOwnersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCarwashOwner = z.infer<typeof insertCarwashOwnerSchema>;
export type CarwashOwner = typeof carwashOwnersTable.$inferSelect;
