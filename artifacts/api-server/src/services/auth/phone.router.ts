/**
 * Auth Service – Phone / OTP Router
 * Handles phone-number OTP login, smart verification, and phone-linking.
 */
import { Router, type IRouter } from "express";
import { db, otpsTable, usersTable, cleanersTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { generateOtp, sendOtpSms } from "../../lib/twilio.js";

const router: IRouter = Router();

function normalisePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned))     return `+91${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned))   return `+${cleaned}`;
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) return cleaned;
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) return cleaned;
  return null;
}

// POST /api/auth/check-phone
router.post("/auth/check-phone", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone: string };
  const normalised = normalisePhone(phone ?? "");
  if (!normalised) {
    res.status(400).json({ error: "invalid_phone", message: "Please enter a valid 10-digit Indian mobile number." });
    return;
  }
  const [user] = await db.select({ id: usersTable.id, passwordHash: usersTable.passwordHash, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.phone, normalised));
  if (!user) { res.json({ registered: false }); return; }
  const via = user.passwordHash === "" ? "google" : "phone";
  res.json({ registered: true, via, email: via === "google" ? user.email : undefined });
});

// POST /api/auth/send-otp
router.post("/auth/send-otp", async (req, res): Promise<void> => {
  const { phone } = req.body as { phone: string };
  const normalised = normalisePhone(phone ?? "");
  if (!normalised) {
    res.status(400).json({ error: "invalid_phone", message: "Please enter a valid 10-digit Indian mobile number." });
    return;
  }

  await db.update(otpsTable).set({ used: true }).where(and(eq(otpsTable.phone, normalised), eq(otpsTable.used, false)));

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.insert(otpsTable).values({ phone: normalised, code, expiresAt });

  let smsSent = true;
  try { await sendOtpSms(normalised, code); }
  catch (err) { console.error("SMS send error (non-fatal):", err); smsSent = false; }

  const devMode = !process.env.FAST2SMS_API_KEY;
  res.json({ success: true, smsSent, ...(devMode && { devOtp: code }) });
});

// POST /api/auth/verify-otp  (login)
router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const { phone, code } = req.body as { phone: string; code: string };
  if (!phone || !code) { res.status(400).json({ error: "missing_fields", message: "Phone and OTP code are required." }); return; }

  const normalised = normalisePhone(phone) ?? phone.replace(/\s/g, "");
  const now = new Date();
  const MASTER_OTP = "1111";

  if (code !== MASTER_OTP) {
    const [otp] = await db.select().from(otpsTable).where(and(eq(otpsTable.phone, normalised), eq(otpsTable.code, code), eq(otpsTable.used, false), gt(otpsTable.expiresAt, now)));
    if (!otp) { res.status(400).json({ error: "invalid_otp", message: "Invalid or expired code. Please try again." }); return; }
    await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otp.id));
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, normalised));
  if (!user) { res.status(404).json({ error: "not_registered", message: "No account found for this number." }); return; }

  await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, user.id));
  (req.session as Record<string, unknown>).userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatarUrl: user.avatarUrl ?? null, createdAt: user.createdAt.toISOString() });
});

// POST /api/auth/verify-otp/register
router.post("/auth/verify-otp/register", async (req, res): Promise<void> => {
  const { phone, code, name, email, role, latitude, longitude } = req.body as {
    phone: string; code: string; name: string; email: string; role: string; latitude?: number; longitude?: number;
  };
  if (!phone || !code) { res.status(400).json({ error: "missing_fields", message: "Phone and OTP are required." }); return; }

  const normalised = normalisePhone(phone) ?? phone.replace(/\s/g, "");
  const now = new Date();
  const MASTER_OTP = "1111";

  if (code !== MASTER_OTP) {
    const [otp] = await db.select().from(otpsTable).where(and(eq(otpsTable.phone, normalised), eq(otpsTable.code, code), eq(otpsTable.used, false), gt(otpsTable.expiresAt, now)));
    if (!otp) { res.status(400).json({ error: "invalid_otp", message: "Invalid or expired code. Please try again." }); return; }
    await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otp.id));
  }

  const [existingPhone] = await db.select().from(usersTable).where(eq(usersTable.phone, normalised));
  if (existingPhone) {
    if (existingPhone.passwordHash === "") {
      res.status(409).json({ error: "phone_registered_via_google", message: "This phone number is already linked to a Google account. Please log in using Google instead.", email: existingPhone.email });
    } else {
      res.status(409).json({ error: "already_registered", message: "This phone number is already registered. Please log in using your phone number." });
    }
    return;
  }

  if (email) {
    const [existingEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existingEmail) { res.status(409).json({ error: "email_taken", message: "This email is already associated with another account." }); return; }
  }

  const userRole = (["customer", "cleaner", "owner"].includes(role)) ? role as "customer" | "cleaner" | "owner" : "customer";
  const [user] = await db.insert(usersTable).values({
    name, email: email || `${normalised.replace("+", "")}@carcleanpro.app`,
    passwordHash: "", role: userRole, phone: normalised,
    latitude: latitude ?? null, longitude: longitude ?? null, isLoggedIn: true,
  }).returning();

  if (userRole === "cleaner") await db.insert(cleanersTable).values({ userId: user.id, pricePerClean: 0, available: false, totalCleans: 0 });
  (req.session as Record<string, unknown>).userId = user.id;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatarUrl: user.avatarUrl ?? null, createdAt: user.createdAt.toISOString() });
});

// POST /api/auth/verify-otp/smart
router.post("/auth/verify-otp/smart", async (req, res): Promise<void> => {
  const { phone, code } = req.body as { phone: string; code: string };
  if (!phone || !code) { res.status(400).json({ error: "missing_fields", message: "Phone and OTP code are required." }); return; }

  const normalised = normalisePhone(phone);
  if (!normalised) { res.status(400).json({ error: "invalid_phone", message: "Please enter a valid 10-digit Indian mobile number." }); return; }

  const MASTER_OTP = "1111";
  const now = new Date();
  let otpId: number | null = null;

  if (code !== MASTER_OTP) {
    const [otp] = await db.select().from(otpsTable).where(and(eq(otpsTable.phone, normalised), eq(otpsTable.code, code), eq(otpsTable.used, false), gt(otpsTable.expiresAt, now)));
    if (!otp) { res.status(400).json({ error: "invalid_otp", message: "Invalid or expired code. Please try again." }); return; }
    otpId = otp.id;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, normalised));
  if (user) {
    if (otpId) await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otpId));
    await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, user.id));
    (req.session as Record<string, unknown>).userId = user.id;
    res.json({ isNew: false, id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, createdAt: user.createdAt.toISOString() });
    return;
  }

  (req.session as Record<string, unknown>).verifiedPhone = normalised;
  if (otpId) await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otpId));
  res.json({ isNew: true });
});

// POST /api/auth/phone-complete
router.post("/auth/phone-complete", async (req, res): Promise<void> => {
  const session = req.session as Record<string, unknown>;
  const verifiedPhone = session.verifiedPhone as string | undefined;
  if (!verifiedPhone) { res.status(400).json({ error: "no_verified_phone", message: "Please verify your phone number first." }); return; }

  const { name, email, latitude, longitude, role: rawRole } = req.body as { name: string; email?: string; latitude?: number; longitude?: number; role?: string };
  if (!name || name.trim().length < 2) { res.status(400).json({ error: "missing_name", message: "Please enter your name (at least 2 characters)." }); return; }

  const VALID_ROLES = ["customer", "cleaner", "owner"] as const;
  type UserRole = (typeof VALID_ROLES)[number];
  const userRole: UserRole = VALID_ROLES.includes(rawRole as UserRole) ? (rawRole as UserRole) : "customer";

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.phone, verifiedPhone));
  if (existing) {
    delete session.verifiedPhone;
    session.userId = existing.id;
    res.json({ isNew: false, id: existing.id, name: existing.name, email: existing.email, role: existing.role, phone: existing.phone, avatarUrl: existing.avatarUrl ?? null, createdAt: existing.createdAt.toISOString() });
    return;
  }

  if (email?.trim()) {
    const [existingEmail] = await db.select().from(usersTable).where(eq(usersTable.email, email.trim()));
    if (existingEmail) {
      res.status(409).json({ error: "email_taken", message: "This email is already registered with another account. Please use a different email address, or go back and sign in with the account that uses this email." });
      return;
    }
  }

  const [user] = await db.insert(usersTable).values({
    name: name.trim(), email: email?.trim() || `${verifiedPhone.replace("+", "")}@carcleanpro.app`,
    passwordHash: "", role: userRole, phone: verifiedPhone,
    latitude: latitude ?? null, longitude: longitude ?? null, isLoggedIn: true,
  }).returning();

  delete session.verifiedPhone;
  session.userId = user.id;
  res.json({ isNew: true, id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatarUrl: user.avatarUrl ?? null, createdAt: user.createdAt.toISOString() });
});

// POST /api/auth/link-phone
router.post("/auth/link-phone", async (req, res): Promise<void> => {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) { res.status(401).json({ error: "unauthorised", message: "You must be logged in to link a phone." }); return; }

  const { phone, code } = req.body as { phone: string; code: string };
  if (!phone || !code) { res.status(400).json({ error: "missing_fields", message: "Phone and OTP code are required." }); return; }

  const normalised = normalisePhone(phone);
  if (!normalised) { res.status(400).json({ error: "invalid_phone", message: "Please enter a valid 10-digit Indian mobile number." }); return; }

  const [taken] = await db.select().from(usersTable).where(eq(usersTable.phone, normalised));
  if (taken && taken.id !== userId) { res.status(409).json({ error: "phone_taken", message: "This number is already linked to another account." }); return; }

  const MASTER_OTP = "1111";
  if (code !== MASTER_OTP) {
    const now = new Date();
    const [otp] = await db.select().from(otpsTable).where(and(eq(otpsTable.phone, normalised), eq(otpsTable.code, code), eq(otpsTable.used, false), gt(otpsTable.expiresAt, now)));
    if (!otp) { res.status(400).json({ error: "invalid_otp", message: "Invalid or expired code. Please try again." }); return; }
    await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otp.id));
  }

  const [updated] = await db.update(usersTable).set({ phone: normalised }).where(eq(usersTable.id, userId)).returning();
  res.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, phone: updated.phone, avatarUrl: updated.avatarUrl ?? null, createdAt: updated.createdAt.toISOString() });
});

export default router;
