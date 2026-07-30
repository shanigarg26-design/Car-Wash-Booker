/**
 * Cleaner Service – Router
 * CRUD for cleaner profiles, availability toggling, and admin-style listing.
 */
import { Router, type IRouter } from "express";
import { db, cleanersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  CreateWasherBody,
  UpdateMyWasherProfileBody,
  GetWasherParams,
  ListWashersQueryParams,
  ListWashersResponse,
  GetWasherResponse,
  GetMyWasherProfileResponse,
  UpdateMyWasherProfileResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Ensures a cleaner-role user always has a `cleaners` profile row.
 * Older/migrated accounts (and any role change) could end up as role="cleaner"
 * WITHOUT a matching cleaners row, which broke GET/PATCH /cleaners/me with a 404
 * (e.g. the Online/Offline toggle). This self-heals by creating a default,
 * OFFLINE profile on demand. Returns null only if the user isn't a cleaner.
 */
async function ensureCleanerProfile(userId: number): Promise<boolean> {
  const [existing] = await db.select({ id: cleanersTable.id }).from(cleanersTable).where(eq(cleanersTable.userId, userId));
  if (existing) return true;

  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.role !== "cleaner") return false;

  await db.insert(cleanersTable)
    .values({ userId, pricePerClean: 0, available: false, totalCleans: 0 })
    .onConflictDoNothing();
  return true;
}

router.get("/cleaners/me", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  if (!(await ensureCleanerProfile(userId))) { res.status(404).json({ error: "Cleaner profile not found" }); return; }

  const [cleaner] = await db
    .select({
      id: cleanersTable.id, userId: cleanersTable.userId, name: usersTable.name,
      phone: cleanersTable.phone, bio: cleanersTable.bio,
      pricePerClean: cleanersTable.pricePerClean, available: cleanersTable.available,
      rating: cleanersTable.rating, totalCleans: cleanersTable.totalCleans,
      createdAt: cleanersTable.createdAt,
    })
    .from(cleanersTable)
    .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(eq(cleanersTable.userId, userId));

  if (!cleaner) { res.status(404).json({ error: "Cleaner profile not found" }); return; }
  res.json(GetMyWasherProfileResponse.parse({ ...cleaner, pricePerWash: cleaner.pricePerClean, totalWashes: cleaner.totalCleans, name: cleaner.name ?? "", createdAt: cleaner.createdAt.toISOString() }));
});

router.patch("/cleaners/me", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = UpdateMyWasherProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  if (!(await ensureCleanerProfile(userId))) { res.status(404).json({ error: "Cleaner profile not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.phone        != null) updateData.phone        = parsed.data.phone;
  if (parsed.data.bio          != null) updateData.bio          = parsed.data.bio;
  if (parsed.data.pricePerWash != null) updateData.pricePerClean = parsed.data.pricePerWash;
  if (parsed.data.available    != null) updateData.available    = parsed.data.available;

  const [updated] = await db.update(cleanersTable).set(updateData)
    .where(eq(cleanersTable.userId, userId)).returning();
  if (!updated) { res.status(404).json({ error: "Cleaner profile not found" }); return; }

  // Going online counts as a heartbeat — makes the cleaner immediately eligible for
  // dispatch (which now requires a recent lastSeenAt to exclude phones that are off).
  if (parsed.data.available === true) {
    await db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  res.json(UpdateMyWasherProfileResponse.parse({ ...updated, pricePerWash: updated.pricePerClean, totalWashes: updated.totalCleans, name: user?.name ?? "", createdAt: updated.createdAt.toISOString() }));
});

router.get("/cleaners", async (req, res): Promise<void> => {
  const queryParsed = ListWashersQueryParams.safeParse(req.query);
  const availableFilter = queryParsed.success ? queryParsed.data.available : undefined;
  const conditions = availableFilter === true ? [eq(cleanersTable.available, true)] : [];

  const cleaners = await db
    .select({
      id: cleanersTable.id, userId: cleanersTable.userId, name: usersTable.name,
      phone: cleanersTable.phone, bio: cleanersTable.bio,
      pricePerClean: cleanersTable.pricePerClean, available: cleanersTable.available,
      rating: cleanersTable.rating, totalCleans: cleanersTable.totalCleans,
      createdAt: cleanersTable.createdAt,
    })
    .from(cleanersTable)
    .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json(ListWashersResponse.parse(
    cleaners.map(w => ({ ...w, pricePerWash: w.pricePerClean, totalWashes: w.totalCleans, name: w.name ?? "", createdAt: w.createdAt.toISOString() }))
  ));
});

router.post("/cleaners", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const parsed = CreateWasherBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  const [cleaner] = await db.insert(cleanersTable).values({
    userId, phone: parsed.data.phone ?? null, bio: parsed.data.bio ?? null,
    pricePerClean: parsed.data.pricePerWash, available: true, totalCleans: 0,
  }).returning();

  res.status(201).json(GetWasherResponse.parse({ ...cleaner, pricePerWash: cleaner.pricePerClean, totalWashes: cleaner.totalCleans, name: user?.name ?? "", createdAt: cleaner.createdAt.toISOString() }));
});

router.get("/cleaners/:id", async (req, res): Promise<void> => {
  const rawId  = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetWasherParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [cleaner] = await db
    .select({
      id: cleanersTable.id, userId: cleanersTable.userId, name: usersTable.name,
      phone: cleanersTable.phone, bio: cleanersTable.bio,
      pricePerClean: cleanersTable.pricePerClean, available: cleanersTable.available,
      rating: cleanersTable.rating, totalCleans: cleanersTable.totalCleans,
      createdAt: cleanersTable.createdAt,
    })
    .from(cleanersTable)
    .leftJoin(usersTable, eq(cleanersTable.userId, usersTable.id))
    .where(eq(cleanersTable.id, params.data.id));

  if (!cleaner) { res.status(404).json({ error: "Cleaner not found" }); return; }
  res.json(GetWasherResponse.parse({ ...cleaner, pricePerWash: cleaner.pricePerClean, totalWashes: cleaner.totalCleans, name: cleaner.name ?? "", createdAt: cleaner.createdAt.toISOString() }));
});

export default router;
