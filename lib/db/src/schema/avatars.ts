import { pgTable, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Stores user avatar images IN THE DATABASE (base64) so they survive Render
 * redeploys — the previous implementation wrote to the container's local disk,
 * which Render wipes on every deploy, silently losing uploaded photos.
 * One row per user (userId is the PK). `data` is a base64-encoded image.
 */
export const avatarsTable = pgTable("user_avatars", {
  userId: integer("user_id").primaryKey(),
  mimeType: text("mime_type").notNull(),
  data: text("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Avatar = typeof avatarsTable.$inferSelect;
