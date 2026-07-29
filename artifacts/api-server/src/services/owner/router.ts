/**
 * Car-Wash Owner Service – Router
 * CRUD for registered car-wash business profiles (owner role).
 */
import { Router, type IRouter } from "express";
import { db, carwashOwnersTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateCarwashOwnerBody,
  GetCarwashOwnerParams,
  ListCarwashOwnersResponse,
  GetCarwashOwnerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/carwash-owners", async (_req, res): Promise<void> => {
  const owners = await db
    .select({
      id: carwashOwnersTable.id, userId: carwashOwnersTable.userId,
      businessName: carwashOwnersTable.businessName, address: carwashOwnersTable.address,
      city: carwashOwnersTable.city, phone: carwashOwnersTable.phone,
      description: carwashOwnersTable.description, ownerName: usersTable.name,
      createdAt: carwashOwnersTable.createdAt,
    })
    .from(carwashOwnersTable)
    .leftJoin(usersTable, eq(carwashOwnersTable.userId, usersTable.id));

  res.json(ListCarwashOwnersResponse.parse(
    owners.map(o => ({ ...o, ownerName: o.ownerName ?? "Unknown", createdAt: o.createdAt.toISOString() }))
  ));
});

router.post("/carwash-owners", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = CreateCarwashOwnerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [user]  = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [owner] = await db.insert(carwashOwnersTable).values({
    userId, businessName: parsed.data.businessName,
    address: parsed.data.address, city: parsed.data.city,
    phone: parsed.data.phone ?? null, description: parsed.data.description ?? null,
  }).returning();

  res.status(201).json(GetCarwashOwnerResponse.parse({ ...owner, ownerName: user?.name ?? "Unknown", createdAt: owner.createdAt.toISOString() }));
});

router.get("/carwash-owners/:id", async (req, res): Promise<void> => {
  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetCarwashOwnerParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [owner] = await db
    .select({
      id: carwashOwnersTable.id, userId: carwashOwnersTable.userId,
      businessName: carwashOwnersTable.businessName, address: carwashOwnersTable.address,
      city: carwashOwnersTable.city, phone: carwashOwnersTable.phone,
      description: carwashOwnersTable.description, ownerName: usersTable.name,
      createdAt: carwashOwnersTable.createdAt,
    })
    .from(carwashOwnersTable)
    .leftJoin(usersTable, eq(carwashOwnersTable.userId, usersTable.id))
    .where(eq(carwashOwnersTable.id, params.data.id));

  if (!owner) { res.status(404).json({ error: "Business not found" }); return; }
  res.json(GetCarwashOwnerResponse.parse({ ...owner, ownerName: owner.ownerName ?? "Unknown", createdAt: owner.createdAt.toISOString() }));
});

export default router;
