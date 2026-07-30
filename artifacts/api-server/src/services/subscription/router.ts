/**
 * Subscription / Packages Service – Router
 * Sells prepaid car-wash packages (with a tiered discount that grows with the
 * duration) and tracks a customer's active package.
 */
import { Router, type IRouter } from "express";
import { db, subscriptionsTable, usersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { PACKAGES, priceForPackage } from "../booking/service.js";

const router: IRouter = Router();

// GET /api/packages?vehicleType=&washType=  — the 5 plans priced for this vehicle+clean.
router.get("/packages", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const vehicleType = (req.query.vehicleType as string) || null;
  const cleanType   = (req.query.washType as string) || (req.query.cleanType as string) || "exterior";
  res.json({
    vehicleType, cleanType,
    packages: PACKAGES.map(p => priceForPackage(p, vehicleType, cleanType)),
  });
});

// GET /api/subscriptions/mine — the customer's active (non-expired, washes-left) packages.
router.get("/subscriptions/mine", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.customerId, userId), eq(subscriptionsTable.status, "active"), gt(subscriptionsTable.expiresAt, new Date())));
  res.json(subs.map(s => ({
    ...s,
    washesRemaining: s.washesTotal - s.washesUsed,
    startedAt: s.startedAt.toISOString(), expiresAt: s.expiresAt.toISOString(), createdAt: s.createdAt.toISOString(),
  })));
});

// POST /api/subscriptions  { packageKey, vehicleType, washType }  — buy a package.
router.post("/subscriptions", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { packageKey, vehicleType, washType, cleanType } = req.body as { packageKey?: string; vehicleType?: string; washType?: string; cleanType?: string };
  const pkg = PACKAGES.find(p => p.key === packageKey);
  if (!pkg) { res.status(400).json({ error: "invalid_package", message: "Unknown package." }); return; }
  const finalClean = washType ?? cleanType ?? "exterior";

  const pricing = priceForPackage(pkg, vehicleType ?? null, finalClean);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);

  const [sub] = await db.insert(subscriptionsTable).values({
    customerId: userId, packageKey: pkg.key, vehicleType: vehicleType ?? "", cleanType: finalClean,
    washesTotal: pkg.washes, washesUsed: 0, discountPercent: pkg.discountPercent,
    pricePaid: pricing.packagePrice, startedAt: now, expiresAt, status: "active",
  }).returning();

  res.status(201).json({
    ...sub, washesRemaining: sub.washesTotal, savings: pricing.savings, label: pkg.label,
    startedAt: sub.startedAt.toISOString(), expiresAt: sub.expiresAt.toISOString(), createdAt: sub.createdAt.toISOString(),
  });
});

// PATCH /api/subscriptions/:id/cancel — stop auto-covering future bookings.
router.patch("/subscriptions/:id/cancel", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, id));
  if (!sub) { res.status(404).json({ error: "Subscription not found" }); return; }
  if (sub.customerId !== userId) { res.status(403).json({ error: "Not your subscription" }); return; }

  await db.update(subscriptionsTable).set({ status: "cancelled" }).where(eq(subscriptionsTable.id, id));
  res.json({ ok: true });
});

/**
 * Finds an active package that covers a given vehicle+clean (washes remaining, not
 * expired) for a customer. Used by booking creation to auto-cover a wash.
 */
export async function findCoveringSubscription(customerId: number, vehicleType: string | null, cleanType: string) {
  const subs = await db.select().from(subscriptionsTable)
    .where(and(eq(subscriptionsTable.customerId, customerId), eq(subscriptionsTable.status, "active"), gt(subscriptionsTable.expiresAt, new Date())));
  return subs.find(s => s.washesUsed < s.washesTotal && s.cleanType === cleanType && (!s.vehicleType || s.vehicleType === (vehicleType ?? ""))) ?? null;
}

export default router;
