/**
 * Admin Service – Router
 * Admin authentication, analytics dashboard, and user management.
 * All routes (except login/logout/me) are guarded by adminOnly middleware.
 */
import { Router, type IRouter } from "express";
import { db, usersTable, bookingsTable, feedbackTable, cleanersTable } from "@workspace/db";
import { eq, count, sql, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { adminOnly } from "../../shared/middleware.js";

const router: IRouter = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post("/admin/login", async (req, res): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user || !user.isAdmin) { res.status(401).json({ error: "Invalid admin credentials" }); return; }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Invalid admin credentials" }); return; }

  const session = req.session as unknown as Record<string, unknown>;
  session.userId  = user.id;
  session.isAdmin = true;

  res.json({ id: user.id, name: user.name, email: user.email, isAdmin: true });
});

router.post("/admin/logout", (req, res): void => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

router.get("/admin/me", (req, res): void => {
  const session = req.session as unknown as Record<string, unknown>;
  if (session.isAdmin) res.json({ isAdmin: true, userId: session.userId });
  else res.status(401).json({ error: "Not authenticated as admin" });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get("/admin/stats", adminOnly, async (req, res): Promise<void> => {
  const [
    userCounts, bookingCounts, recentBookings,
    cityBreakdown, vehicleBreakdown, cleanTypeBreakdown,
    statusBreakdown, ratingDistribution, topCleaners,
    recentFeedback, revenue, bookingsTrend,
  ] = await Promise.all([
    db.select({ role: usersTable.role, count: count() })
      .from(usersTable).where(eq(usersTable.isAdmin, false)).groupBy(usersTable.role),

    db.select({ count: count() }).from(bookingsTable),

    db.select({
      id: bookingsTable.id, customerAddress: bookingsTable.customerAddress,
      status: bookingsTable.status, vehicleType: bookingsTable.vehicleType,
      cleanType: bookingsTable.cleanType, priceQuoted: bookingsTable.priceQuoted,
      createdAt: bookingsTable.createdAt,
    }).from(bookingsTable).orderBy(desc(bookingsTable.createdAt)).limit(10),

    db.execute(sql`
      SELECT COALESCE(NULLIF(TRIM(SPLIT_PART(customer_address, ',', 2)), ''), 'Unknown') as city,
             COUNT(id)::int as count,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN price_quoted ELSE 0 END), 0)::int as revenue
      FROM bookings
      GROUP BY COALESCE(NULLIF(TRIM(SPLIT_PART(customer_address, ',', 2)), ''), 'Unknown')
      ORDER BY count DESC LIMIT 15`),

    db.execute(sql`
      SELECT vehicle_type, COUNT(*)::int as count FROM bookings
      WHERE vehicle_type IS NOT NULL GROUP BY vehicle_type ORDER BY count DESC`),

    db.execute(sql`SELECT clean_type, COUNT(*)::int as count FROM bookings GROUP BY clean_type`),

    db.execute(sql`SELECT status, COUNT(*)::int as count FROM bookings GROUP BY status`),

    db.execute(sql`SELECT rating, COUNT(*)::int as count FROM feedback GROUP BY rating ORDER BY rating`),

    db.execute(sql`
      SELECT c.id as cleaner_id, u.name, u.phone,
             COUNT(DISTINCT b.id)::int as completed_bookings,
             COALESCE(SUM(b.price_quoted), 0)::int as total_earned,
             ROUND(AVG(f.rating)::numeric, 1) as avg_rating,
             COUNT(DISTINCT f.id)::int as review_count
      FROM cleaners c
      JOIN users u ON c.user_id = u.id
      LEFT JOIN bookings b ON b.cleaner_id = c.id AND b.status = 'completed'
      LEFT JOIN feedback f ON f.booking_id = b.id AND f.reviewer_role = 'customer'
      GROUP BY u.name, u.phone, c.id
      ORDER BY completed_bookings DESC, total_earned DESC LIMIT 10`),

    db.execute(sql`
      SELECT f.id, f.rating, f.comment, f.reviewer_role, f.created_at,
             ru.name as reviewer_name, b.customer_address, b.vehicle_type, b.clean_type
      FROM feedback f
      JOIN users ru ON f.reviewer_id = ru.id
      JOIN bookings b ON f.booking_id = b.id
      ORDER BY f.created_at DESC LIMIT 20`),

    db.execute(sql`
      SELECT COALESCE(SUM(price_quoted), 0)::int as total_revenue,
             COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed_count,
             ROUND(AVG(CASE WHEN status = 'completed' THEN price_quoted END)::numeric, 0)::int as avg_booking_value,
             (SELECT ROUND(AVG(rating)::numeric, 1) FROM feedback WHERE reviewer_role = 'customer') as avg_rating
      FROM bookings`),

    db.execute(sql`
      SELECT DATE(created_at AT TIME ZONE 'Asia/Kolkata') as date,
             COUNT(*)::int as bookings,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN price_quoted ELSE 0 END), 0)::int as revenue
      FROM bookings
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at AT TIME ZONE 'Asia/Kolkata')
      ORDER BY date`),
  ]);

  const rev = (revenue.rows as Record<string, unknown>[])[0] ?? {};

  res.json({
    overview: {
      totalUsers:        userCounts.reduce((s, r) => s + Number(r.count), 0),
      totalCustomers:    Number(userCounts.find(r => r.role === "customer")?.count ?? 0),
      totalCleaners:     Number(userCounts.find(r => r.role === "cleaner")?.count ?? 0),
      totalBookings:     bookingCounts[0]?.count ?? 0,
      totalRevenue:      rev.total_revenue ?? 0,
      completedBookings: rev.completed_count ?? 0,
      avgBookingValue:   rev.avg_booking_value ?? 0,
      avgRating:         rev.avg_rating ?? null,
    },
    recentBookings:      recentBookings.map(b => ({ ...b, createdAt: b.createdAt.toISOString() })),
    cityBreakdown:       (cityBreakdown.rows      as any[]).map(r => ({ city: r.city, count: r.count, revenue: r.revenue })),
    vehicleBreakdown:    (vehicleBreakdown.rows   as any[]).map(r => ({ vehicleType: r.vehicle_type, count: r.count })),
    cleanTypeBreakdown:  (cleanTypeBreakdown.rows as any[]).map(r => ({ cleanType: r.clean_type || "exterior", count: r.count })),
    statusBreakdown:     (statusBreakdown.rows    as any[]).map(r => ({ status: r.status, count: r.count })),
    ratingDistribution:  (ratingDistribution.rows as any[]).map(r => ({ rating: r.rating, count: r.count })),
    topCleaners:         (topCleaners.rows        as any[]).map(r => ({
      cleanerId: r.cleaner_id, name: r.name, phone: r.phone,
      completedJobs: r.completed_bookings, totalEarned: r.total_earned,
      avgRating: r.avg_rating, reviewCount: r.review_count,
    })),
    recentFeedback:      (recentFeedback.rows     as any[]).map(r => ({
      id: r.id, rating: r.rating, comment: r.comment, reviewerRole: r.reviewer_role,
      reviewerName: r.reviewer_name, customerAddress: r.customer_address,
      vehicleType: r.vehicle_type, cleanType: r.clean_type, createdAt: r.created_at,
    })),
    bookingsTrend:       (bookingsTrend.rows      as any[]).map(r => ({ date: r.date, bookings: r.bookings, revenue: r.revenue })),
  });
});

router.get("/admin/users", adminOnly, async (_req, res): Promise<void> => {
  const users = await db.execute(sql`
    SELECT u.id, u.name, u.email, u.role, u.phone, u.created_at,
           CASE WHEN u.role = 'cleaner' THEN c.available ELSE NULL END as available,
           CASE WHEN u.role = 'cleaner' THEN c.price_per_clean ELSE NULL END as price_per_clean,
           (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id)::int as booking_count
    FROM users u
    LEFT JOIN cleaners c ON c.user_id = u.id
    WHERE u.is_admin = false
    ORDER BY u.created_at DESC LIMIT 100`);
  res.json(users.rows);
});

export default router;
