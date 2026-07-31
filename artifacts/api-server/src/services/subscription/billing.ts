/**
 * Weekly billing for postpaid "daily" packages. Called from the internal sweep.
 * For every active daily package it:
 *   1. Closes each fully-elapsed week into a bill = (washes done that week × rate).
 *   2. Nudges owner + washer while a bill is unpaid past its due date.
 *   3. Auto-cancels the package once a bill stays unpaid past the 3-day grace.
 * Settlement is offline — the washer taps "Payment received" (see router).
 */
import { db, subscriptionsTable, packageBillsTable, bookingsTable, cleanersTable, usersTable } from "@workspace/db";
import { eq, and, gte, lt, inArray } from "drizzle-orm";
import { sendPush } from "../../shared/push.js";

const WEEK_MS  = 7 * 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

async function pushUser(userId: number, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  const [u] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, userId));
  if (u?.token) await sendPush([u.token], title, body, data);
}
async function washerUserId(cleanerId: number): Promise<number | null> {
  const [c] = await db.select({ uid: cleanersTable.userId }).from(cleanersTable).where(eq(cleanersTable.id, cleanerId));
  return c?.uid ?? null;
}

export async function runPackageBillingSweep(): Promise<{ billsCreated: number; autoCancelled: number; reminded: number }> {
  const now = Date.now();
  let billsCreated = 0, autoCancelled = 0, reminded = 0;

  const pkgs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.kind, "daily"), eq(subscriptionsTable.status, "active")));

  for (const pkg of pkgs) {
    const rate = pkg.pricePerWash ?? 0;
    const start = pkg.startedAt.getTime();
    const existing = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, pkg.id));
    const byWeek = new Map(existing.map(b => [b.weekIndex, b]));

    // 1) Close every fully-elapsed week that isn't billed yet.
    const weeksElapsed = Math.floor((now - start) / WEEK_MS);
    for (let k = 0; k < weeksElapsed; k++) {
      if (byWeek.has(k)) continue;
      const weekStart = new Date(start + k * WEEK_MS);
      const weekEnd   = new Date(start + (k + 1) * WEEK_MS);
      const done = await db.select({ id: bookingsTable.id }).from(bookingsTable).where(and(
        eq(bookingsTable.subscriptionId, pkg.id),
        eq(bookingsTable.status, "completed"),
        gte(bookingsTable.completedAt, weekStart),
        lt(bookingsTable.completedAt, weekEnd),
      ));
      const washesCount = done.length;
      if (washesCount === 0) continue; // nothing done that week → no bill
      const amountDue = washesCount * rate;
      const dueDate = new Date(weekEnd.getTime() + GRACE_MS);
      const [bill] = await db.insert(packageBillsTable).values({
        subscriptionId: pkg.id, weekIndex: k, weekStart, weekEnd, washesCount, amountDue,
        status: "due", dueDate,
      }).returning();
      byWeek.set(k, bill);
      billsCreated++;
      const wk = k + 1;
      await pushUser(pkg.customerId, "💵 Weekly wash bill", `₹${amountDue} due for week ${wk} (${washesCount} wash${washesCount > 1 ? "es" : ""}). Please pay your washer directly.`, { type: "package_bill_due", subscriptionId: pkg.id });
      if (pkg.cleanerId) { const uid = await washerUserId(pkg.cleanerId); if (uid) await pushUser(uid, "💵 Weekly payment", `You’ll receive ₹${amountDue} for week ${wk} (${washesCount} wash${washesCount > 1 ? "es" : ""}). Tap “Payment received” once paid.`, { type: "package_payment_incoming", subscriptionId: pkg.id }); }
    }

    // 2 & 3) Handle unpaid bills: remind, then auto-cancel past the grace window.
    let autoCancelledThis = false;
    for (const bill of byWeek.values()) {
      if (bill.status !== "due") continue;
      const due = bill.dueDate.getTime();
      if (now > due) {
        // Past the 3-day grace → auto-cancel the package.
        await db.update(subscriptionsTable).set({ status: "cancelled" }).where(eq(subscriptionsTable.id, pkg.id));
        await db.update(bookingsTable).set({ status: "cancelled", cleanerId: null })
          .where(and(eq(bookingsTable.subscriptionId, pkg.id), inArray(bookingsTable.status, ["scheduled", "accepted", "arrived"])));
        autoCancelled++;
        autoCancelledThis = true;
        await pushUser(pkg.customerId, "Package cancelled — payment overdue", `Week ${bill.weekIndex + 1}'s ₹${bill.amountDue} wasn’t settled in time, so the package was cancelled.`, { type: "package_autocancelled", subscriptionId: pkg.id });
        if (pkg.cleanerId) { const uid = await washerUserId(pkg.cleanerId); if (uid) await pushUser(uid, "Package cancelled — unpaid", `Week ${bill.weekIndex + 1}'s payment wasn’t received in time. The package was cancelled and you’re freed from its remaining days.`, { type: "package_autocancelled", subscriptionId: pkg.id }); }
        break; // package is gone; stop processing its other bills
      } else if (now > bill.weekEnd.getTime() + 24 * 60 * 60 * 1000 && !bill.remindedAt) {
        // A day past week-end and still unpaid → remind owner and ask the washer.
        await db.update(packageBillsTable).set({ remindedAt: new Date() }).where(eq(packageBillsTable.id, bill.id));
        reminded++;
        await pushUser(pkg.customerId, "Payment reminder", `₹${bill.amountDue} for week ${bill.weekIndex + 1} is still pending. Pay your washer to keep the package running.`, { type: "package_bill_due", subscriptionId: pkg.id });
        if (pkg.cleanerId) { const uid = await washerUserId(pkg.cleanerId); if (uid) await pushUser(uid, "Payment pending", `You haven’t confirmed payment for week ${bill.weekIndex + 1}. Do you want to continue the package? You can cancel it if you’d prefer not to.`, { type: "package_payment_pending", subscriptionId: pkg.id }); }
      }
    }

    // 4) Package finished (past its end date) → settle any remaining washes, close it,
    //    and invite the owner to renew.
    if (!autoCancelledThis && now > pkg.expiresAt.getTime()) {
      const doneRows = await db.select({ id: bookingsTable.id }).from(bookingsTable)
        .where(and(eq(bookingsTable.subscriptionId, pkg.id), eq(bookingsTable.status, "completed")));
      const billsNow = await db.select().from(packageBillsTable).where(eq(packageBillsTable.subscriptionId, pkg.id));
      const billedWashes = billsNow.reduce((s, x) => s + x.washesCount, 0);
      const unbilled = doneRows.length - billedWashes;
      if (unbilled > 0 && rate > 0) {
        const nextWeek = billsNow.reduce((m, x) => Math.max(m, x.weekIndex + 1), 0);
        const end = new Date(now);
        await db.insert(packageBillsTable).values({
          subscriptionId: pkg.id, weekIndex: nextWeek, weekStart: end, weekEnd: end,
          washesCount: unbilled, amountDue: unbilled * rate, status: "due",
          dueDate: new Date(now + GRACE_MS),
        });
      }
      await db.update(subscriptionsTable).set({ status: "expired" }).where(eq(subscriptionsTable.id, pkg.id));
      await pushUser(pkg.customerId, "Package finished 🎉", "Your daily wash package has ended. Tap to start a new one and keep your car spotless.", { type: "package_ended", subscriptionId: pkg.id });
    }
  }

  return { billsCreated, autoCancelled, reminded };
}
