/**
 * User Service – Router
 * Covers user registration/login, profile fetching, push-token registration,
 * GPS location updates, logout, and avatar upload.
 */
import { Router, type IRouter } from "express";
import bcryptjs from "bcryptjs";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { db, usersTable, cleanersTable, bookingsTable, bookingDispatchesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { haversineKm, MAX_DISPATCH_RADIUS_KM, dispatchToNearestCleaners } from "../booking/dispatcher.js";
import {
  RegisterUserBody,
  LoginUserBody,
  LoginUserResponse,
  GetCurrentUserResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

// ── Avatar upload setup ───────────────────────────────────────────────────────
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const avatarsDir  = path.join(__dirname, "../../../public/avatars");
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, avatarsDir),
  filename:    (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) cb(new Error("Only image files are allowed"));
    else cb(null, true);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function toUserResponse(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id, name: user.name, email: user.email,
    role: user.role, phone: user.phone,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

// ── Routes ────────────────────────────────────────────────────────────────────
router.post("/users/register", async (req, res): Promise<void> => {
  const parsed = RegisterUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { name, email, password, role, phone } = parsed.data;
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing.length > 0) {
    res.status(409).json({ error: "already_registered", message: "This email is already registered. Please log in instead." });
    return;
  }

  const passwordHash = await bcryptjs.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ name, email, passwordHash, role, phone: phone ?? null, isLoggedIn: true }).returning();
  (req.session as Record<string, unknown>).userId = user.id;
  res.status(201).json(LoginUserResponse.parse(toUserResponse(user)));
});

router.post("/users/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid credentials" }); return; }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(404).json({ error: "not_registered", message: "No account found with this email address. Please register first." });
    return;
  }
  const valid = await bcryptjs.compare(password, user.passwordHash);
  if (!valid) { res.status(400).json({ error: "wrong_password", message: "Incorrect password. Please try again." }); return; }

  await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, user.id));
  (req.session as Record<string, unknown>).userId = user.id;
  res.json(LoginUserResponse.parse(toUserResponse(user)));
});

router.get("/users/me", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }

  res.json(GetCurrentUserResponse.parse(toUserResponse(user)));
});

router.post("/auth/push-token", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { token } = req.body as { token?: string };
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "invalid_token", message: "Push token is required." });
    return;
  }
  await db.update(usersTable).set({ expoPushToken: token }).where(eq(usersTable.id, userId));
  res.json({ ok: true });
});

router.patch("/users/me/location", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { latitude, longitude } = req.body as { latitude?: number; longitude?: number };
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    res.status(400).json({ error: "latitude and longitude are required numbers" });
    return;
  }

  // Update the user's GPS location
  await db.update(usersTable).set({ latitude, longitude, lastSeenAt: new Date() }).where(eq(usersTable.id, userId));
  res.json({ ok: true });

  // Proactive dispatch: if this user is an available cleaner, immediately check for any
  // "searching" bookings within 5km that haven't dispatched to this cleaner yet.
  // This ensures a cleaner sees a pending booking the moment they come online — without
  // waiting for the 10s retry timer to fire.
  (async () => {
    try {
      const [cleaner] = await db
        .select({ id: cleanersTable.id, available: cleanersTable.available })
        .from(cleanersTable)
        .where(eq(cleanersTable.userId, userId));
      if (!cleaner?.available) return;

      // Find all bookings currently in "searching" state
      const searchingBookings = await db
        .select()
        .from(bookingsTable)
        .where(eq(bookingsTable.status, "searching"));

      for (const booking of searchingBookings) {
        if (!booking.customerLat || !booking.customerLng) continue;
        const dist = haversineKm(latitude, longitude, booking.customerLat, booking.customerLng);
        if (dist > MAX_DISPATCH_RADIUS_KM) continue;

        // Check if this cleaner was already dispatched for this booking
        const existing = await db
          .select({ id: bookingDispatchesTable.id })
          .from(bookingDispatchesTable)
          .where(
            and(
              eq(bookingDispatchesTable.bookingId, booking.id),
              eq(bookingDispatchesTable.cleanerId, cleaner.id)
            )
          );
        if (existing.length > 0) continue;

        // Get all already-tried cleaners to exclude
        const tried = await db
          .select({ cleanerId: bookingDispatchesTable.cleanerId })
          .from(bookingDispatchesTable)
          .where(eq(bookingDispatchesTable.bookingId, booking.id));
        const excludeIds = tried.map(d => d.cleanerId);

        // Dispatch (this cleaner will be included since they're not in excludeIds)
        await dispatchToNearestCleaners(
          booking.id,
          booking.customerLat,
          booking.customerLng,
          excludeIds,
          1,
          {
            vehicleType: booking.vehicleType ?? null,
            cleanType:   booking.cleanType   ?? null,
            address:     booking.customerAddress,
            price:       booking.price,
          },
        );
        console.log(`[ProactiveDispatch] Booking ${booking.id} dispatched to cleaner ${cleaner.id} (just came online)`);
      }
    } catch (err) {
      console.error("[ProactiveDispatch] Error:", err);
    }
  })();
});

router.patch("/users/me", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { name } = req.body as { name?: string };
  if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

  const [updated] = await db.update(usersTable).set({ name: name.trim() }).where(eq(usersTable.id, userId)).returning();
  res.json(GetCurrentUserResponse.parse(toUserResponse(updated)));
});

router.post("/users/avatar", upload.single("avatar"), async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const avatarPath = `/api/avatars/${req.file.filename}`;
  await db.update(usersTable).set({ avatarUrl: avatarPath }).where(eq(usersTable.id, userId));
  res.json({ avatarUrl: avatarPath });
});

// POST /api/users/auth/google
// Native-client flow: client has already authenticated with Google and holds an access token.
// Verifies it against Google's userinfo endpoint, then finds/creates the user.
// If user doesn't exist and no role is provided, returns { isNewUser: true, name, email }
// so the client can show role selection before calling again with a role.
router.post("/users/auth/google", async (req, res): Promise<void> => {
  const { accessToken, role } = req.body as { accessToken?: string; role?: string };

  if (!accessToken) {
    res.status(400).json({ error: "missing_token", message: "Google access token is required." });
    return;
  }

  // Verify token + fetch profile from Google
  const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!infoRes.ok) {
    res.status(401).json({ error: "invalid_token", message: "Could not verify Google token. Please try again." });
    return;
  }

  const profile = await infoRes.json() as { sub: string; email: string; name: string; picture?: string };

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, profile.email));

  if (!existing) {
    // New user — if no role provided, ask the client to pick one
    if (!role) {
      res.status(200).json({ isNewUser: true, name: profile.name, email: profile.email });
      return;
    }

    // Role provided — create the account
    const validRoles = ["customer", "cleaner", "owner"] as const;
    type UserRole = (typeof validRoles)[number];
    const userRole: UserRole = validRoles.includes(role as UserRole) ? (role as UserRole) : "customer";

    const [created] = await db.insert(usersTable).values({
      name: profile.name,
      email: profile.email,
      passwordHash: "",
      role: userRole,
      phone: null,
      isLoggedIn: true,
    }).returning();

    (req.session as Record<string, unknown>).userId = created.id;
    res.json(LoginUserResponse.parse(toUserResponse(created)));
    return;
  }

  // Existing user — check if they registered via phone (different auth method)
  if (role && existing.passwordHash !== "") {
    res.status(409).json({
      error: "email_registered_via_phone",
      message: "This email is already registered using a phone number. Please log in with your phone number instead.",
      phone: existing.phone ?? undefined,
    });
    return;
  }

  // Log them in
  await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, existing.id));
  (req.session as Record<string, unknown>).userId = existing.id;
  res.json(LoginUserResponse.parse(toUserResponse(existing)));
});

router.post("/users/logout", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (userId) await db.update(usersTable).set({ isLoggedIn: false }).where(eq(usersTable.id, userId));
  (req.session as Record<string, unknown>).userId = undefined;
  res.json({ message: "Logged out successfully" });
});

export default router;
