/**
 * Messaging Service – Router
 * In-app chat between a booking's customer and its assigned cleaner.
 * Only those two parties can read/write a booking's thread.
 */
import { Router, type IRouter } from "express";
import { db, messagesTable, bookingsTable, cleanersTable, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { sendPush } from "../../shared/push.js";

const router: IRouter = Router();

/** Returns the caller's role for this booking, or null if they're not a participant. */
async function participantRole(userId: number, booking: typeof bookingsTable.$inferSelect): Promise<"customer" | "cleaner" | null> {
  if (booking.customerId === userId) return "customer";
  if (booking.cleanerId) {
    const [cleaner] = await db.select({ id: cleanersTable.id }).from(cleanersTable).where(eq(cleanersTable.userId, userId));
    if (cleaner && cleaner.id === booking.cleanerId) return "cleaner";
  }
  return null;
}

router.get("/bookings/:id/messages", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (!(await participantRole(userId, booking))) { res.status(403).json({ error: "Not a participant in this booking" }); return; }

  const msgs = await db.select().from(messagesTable).where(eq(messagesTable.bookingId, bookingId)).orderBy(asc(messagesTable.createdAt));
  res.json(msgs.map(m => ({ ...m, mine: m.senderId === userId, createdAt: m.createdAt.toISOString() })));
});

router.post("/bookings/:id/messages", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = parseInt(req.params.id, 10);
  if (isNaN(bookingId)) { res.status(400).json({ error: "Invalid booking ID" }); return; }

  const text = (req.body?.text as string ?? "").trim();
  if (!text) { res.status(400).json({ error: "empty_message", message: "Message cannot be empty." }); return; }
  if (text.length > 2000) { res.status(400).json({ error: "too_long", message: "Message is too long." }); return; }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  const role = await participantRole(userId, booking);
  if (!role) { res.status(403).json({ error: "Not a participant in this booking" }); return; }

  const [msg] = await db.insert(messagesTable).values({ bookingId, senderId: userId, senderRole: role, text }).returning();

  // Notify the OTHER party.
  try {
    const otherUserId = role === "customer"
      ? (booking.cleanerId ? (await db.select({ uid: cleanersTable.userId }).from(cleanersTable).where(eq(cleanersTable.id, booking.cleanerId)))[0]?.uid : undefined)
      : booking.customerId;
    if (otherUserId) {
      const [other] = await db.select({ token: usersTable.expoPushToken }).from(usersTable).where(eq(usersTable.id, otherUserId));
      if (other?.token) await sendPush([other.token], "💬 New message", text.slice(0, 120), { type: "new_message", bookingId });
    }
  } catch { /* non-critical */ }

  res.status(201).json({ ...msg, mine: true, createdAt: msg.createdAt.toISOString() });
});

export default router;
