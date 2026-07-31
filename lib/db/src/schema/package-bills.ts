import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * A weekly bill for a postpaid "daily" package. One row per completed week; the
 * amount owed = (washes actually done that week) × the washer's per-wash rate.
 * Settled offline: the washer taps "Payment received" and the owner sees it paid.
 */
export const packageBillsTable = pgTable("package_bills", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull(),
  weekIndex: integer("week_index").notNull(),      // 0-based week number within the package
  weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
  weekEnd: timestamp("week_end", { withTimezone: true }).notNull(),
  washesCount: integer("washes_count").notNull(),
  amountDue: integer("amount_due").notNull(),
  status: text("status").notNull().default("due"),  // due | paid
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(), // weekEnd + grace
  paidAt: timestamp("paid_at", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),      // last overdue nudge
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One bill per (package, week) — prevents concurrent/overlapping sweeps double-billing.
  uniqWeek: uniqueIndex("package_bills_sub_week_uq").on(t.subscriptionId, t.weekIndex),
}));

export type PackageBill = typeof packageBillsTable.$inferSelect;
