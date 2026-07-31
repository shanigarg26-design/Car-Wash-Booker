/**
 * Feedback Service – Router
 * Handles customer and washer ratings/reviews for completed bookings.
 */
import { Router, type IRouter } from "express";
import { db, feedbackTable, bookingsTable, usersTable, cleanersTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";

const router: IRouter = Router();

router.post("/feedback", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { bookingId, rating, comment } = req.body;
  const ratingNum = Number(rating);
  if (!bookingId || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    res.status(400).json({ error: "bookingId and rating (1-5) required" }); return;
  }

  const [booking] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, Number(bookingId)));
  if (!booking) { res.status(404).json({ error: "Booking not found" }); return; }
  if (booking.status !== "completed") {
    res.status(400).json({ error: "not_completed", message: "You can only review a completed booking." }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const isCustomer   = booking.customerId === userId;
  const reviewerRole = isCustomer ? "customer" : "cleaner";

  if (!isCustomer) {
    // The only non-customer allowed to review is the cleaner assigned to THIS booking.
    // (This app's role is "cleaner"; the previous check compared against a non-existent
    // "washer" role, so cleaners could never leave a review — always 403.)
    const [cleaner] = await db.select({ id: cleanersTable.id }).from(cleanersTable).where(eq(cleanersTable.userId, userId));
    if (!cleaner || booking.cleanerId !== cleaner.id) {
      res.status(403).json({ error: "Not authorized to review this booking" }); return;
    }
  }

  const existing = await db
    .select()
    .from(feedbackTable)
    .where(and(eq(feedbackTable.bookingId, Number(bookingId)), eq(feedbackTable.reviewerId, userId)));
  if (existing.length > 0) { res.status(409).json({ error: "You have already reviewed this booking" }); return; }

  const [created] = await db.insert(feedbackTable).values({
    bookingId: Number(bookingId), reviewerId: userId,
    reviewerRole, rating: ratingNum, comment: comment || null,
  }).returning();

  // When a CUSTOMER rates a cleaner, refresh that cleaner's average rating so it
  // surfaces on their profile card (previously ratings were stored but never rolled up).
  if (isCustomer && booking.cleanerId) {
    await db.execute(sql`
      UPDATE cleaners SET rating = sub.avg FROM (
        SELECT AVG(f.rating)::real AS avg
        FROM feedback f JOIN bookings b ON b.id = f.booking_id
        WHERE b.cleaner_id = ${booking.cleanerId} AND f.reviewer_role = 'customer'
      ) sub
      WHERE cleaners.id = ${booking.cleanerId}`);
  }

  res.status(201).json(created);
});

router.get("/feedback/booking/:id", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const bookingId = Number(req.params.id);
  const reviews   = await db
    .select({
      id: feedbackTable.id, bookingId: feedbackTable.bookingId,
      reviewerId: feedbackTable.reviewerId, reviewerRole: feedbackTable.reviewerRole,
      rating: feedbackTable.rating, comment: feedbackTable.comment,
      createdAt: feedbackTable.createdAt, reviewerName: usersTable.name,
    })
    .from(feedbackTable)
    .leftJoin(usersTable, eq(feedbackTable.reviewerId, usersTable.id))
    .where(eq(feedbackTable.bookingId, bookingId));

  res.json(reviews.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/feedback/mine", async (req, res): Promise<void> => {
  const userId = (req.session as unknown as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const reviews = await db.select().from(feedbackTable).where(eq(feedbackTable.reviewerId, userId));
  res.json(reviews.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

export default router;
