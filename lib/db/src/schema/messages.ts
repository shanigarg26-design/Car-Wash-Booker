import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/** In-app chat messages between a booking's customer and the assigned cleaner. */
export const messagesTable = pgTable("messages", {
  id: serial("id").primaryKey(),
  bookingId: integer("booking_id").notNull(),
  senderId: integer("sender_id").notNull(),
  senderRole: text("sender_role").notNull(), // customer | cleaner
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Message = typeof messagesTable.$inferSelect;
