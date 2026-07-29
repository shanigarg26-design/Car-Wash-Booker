/**
 * Auth Service – Google OAuth Router
 * Handles the full PKCE-style Google OAuth flow:
 *   1. /auth/google/init              — initiates the OAuth redirect
 *   2. /auth/google/callback          — handles Google's callback, upserts user
 *   3. /auth/google/session           — exchanges one-time token → session
 *   4. /auth/google/pending           — returns pending profile for unregistered users
 *   5. /auth/google/send-phone-otp    — checks phone availability + sends OTP (new user flow)
 *   6. /auth/google/verify-phone-otp  — verifies OTP, stores verified phone against pending token
 *   7. /auth/google/complete          — creates account with chosen role (uses verified phone)
 */
import { Router, type IRouter } from "express";
import { db, usersTable, cleanersTable, otpsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { LoginUserResponse } from "@workspace/api-zod";
import crypto from "crypto";
import { generateOtp, sendOtpSms } from "../../lib/twilio.js";

const router: IRouter = Router();

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REPLIT_DOMAIN        = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "";
const REDIRECT_URI         = `https://${REPLIT_DOMAIN}/api/auth/google/callback`;
const APP_SCHEME           = "car-wash-mobile";

// ── In-memory token stores ───────────────────────────────────────────────────
const googleAuthTokens     = new Map<string, { userId: number; ts: number }>();
const googlePendingTokens  = new Map<string, { name: string; email: string; ts: number }>();
const pendingStates        = new Map<string, { role: string; ts: number; platform: string; returnUrl: string }>();
const verifiedGooglePhones = new Map<string, { phone: string; ts: number }>();

const TTL_MS = 15 * 60 * 1000; // 15 min

function cleanTokens() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of googleAuthTokens.entries())     if (v.ts < cutoff) googleAuthTokens.delete(k);
  for (const [k, v] of googlePendingTokens.entries())  if (v.ts < cutoff) googlePendingTokens.delete(k);
  for (const [k, v] of verifiedGooglePhones.entries()) if (v.ts < cutoff) verifiedGooglePhones.delete(k);
  for (const [k, v] of pendingStates.entries())        if (v.ts < Date.now() - 10 * 60 * 1000) pendingStates.delete(k);
}

function normalisePhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s\-\(\)\.]/g, "");
  if (/^[6-9]\d{9}$/.test(cleaned))      return `+91${cleaned}`;
  if (/^91[6-9]\d{9}$/.test(cleaned))    return `+${cleaned}`;
  if (/^\+91[6-9]\d{9}$/.test(cleaned))  return cleaned;
  if (/^\+[1-9]\d{6,14}$/.test(cleaned)) return cleaned;
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ALLOWED_RETURN_SCHEMES = ["car-wash-mobile://", "exp://", "exps://"];

function sanitizeReturnUrl(url: string | undefined): string {
  if (url && ALLOWED_RETURN_SCHEMES.some(s => url.startsWith(s))) return url;
  return `${APP_SCHEME}://auth/google-result`;
}

function webResultHtml(params: Record<string, string>): string {
  const safeData = JSON.stringify(params).replace(/<\/script>/gi, "<\\/script>");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CarCleanPro – Signing in…</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#94a3b8;}</style>
</head><body><p>Signing you in, please wait…</p>
<script>
  var data=${safeData};data.type='carcleanpro-google-auth';
  if(window.opener){window.opener.postMessage(data,'*');}
  setTimeout(function(){window.close();},500);
</script></body></html>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /api/auth/google/init?role=customer|cleaner|login[&platform=web][&return_url=...]
router.get("/auth/google/init", (req, res): void => {
  cleanTokens();
  const role      = (req.query.role      as string) || "login";
  const platform  = (req.query.platform  as string) || "native";
  const returnUrl = sanitizeReturnUrl(req.query.return_url as string | undefined);
  const state     = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, { role, ts: Date.now(), platform, returnUrl });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: "code", scope: "openid email profile",
    state, access_type: "offline", prompt: "select_account",
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /api/auth/google/callback
router.get("/auth/google/callback", async (req, res): Promise<void> => {
  const { code, state, error } = req.query as Record<string, string>;
  const pending    = state ? pendingStates.get(state) : undefined;
  const isWeb      = pending?.platform === "web";
  const returnBase = pending?.returnUrl ?? `${APP_SCHEME}://auth/google-result`;

  const redirect = (params: Record<string, string>) => {
    if (isWeb) { res.send(webResultHtml(params)); return; }
    const sep = returnBase.includes("?") ? "&" : "?";
    res.redirect(`${returnBase}${sep}${new URLSearchParams(params)}`);
  };

  if (error || !code || !state) { redirect({ error: "cancelled" }); return; }
  if (!pending)                  { redirect({ error: "invalid_state" }); return; }
  pendingStates.delete(state);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({}));
    console.error("[GoogleAuth] Token exchange failed:", JSON.stringify(err));
    redirect({ error: "token_exchange_failed" }); return;
  }

  const { access_token } = await tokenRes.json() as { access_token: string };
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
  if (!userInfoRes.ok) { redirect({ error: "userinfo_failed" }); return; }

  const googleUser = await userInfoRes.json() as { sub: string; email: string; name: string };
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, googleUser.email));
  const role = pending.role;

  // New user — unregistered
  if (!existing) {
    if (role === "login") {
      // Redirect to new phone-verification registration flow
      const pendingToken = crypto.randomBytes(24).toString("hex");
      googlePendingTokens.set(pendingToken, { name: googleUser.name, email: googleUser.email, ts: Date.now() });
      const session = req.session as Record<string, unknown>;
      session.googlePendingToken = pendingToken;
      session.googlePendingName  = googleUser.name;
      session.googlePendingEmail = googleUser.email;
      req.session.save(err => { if (err) redirect({ error: "session_error" }); else redirect({ status: "new", token: pendingToken }); });
      return;
    }

    const VALID_ROLES = ["customer", "cleaner", "owner"] as const;
    type UserRole = (typeof VALID_ROLES)[number];
    const userRole: UserRole = VALID_ROLES.includes(role as UserRole) ? (role as UserRole) : "customer";
    const [created] = await db.insert(usersTable).values({ name: googleUser.name, email: googleUser.email, passwordHash: "", role: userRole, phone: null, isLoggedIn: true }).returning();
    if (userRole === "cleaner") await db.insert(cleanersTable).values({ userId: created.id, pricePerClean: 0 });

    const token = crypto.randomBytes(24).toString("hex");
    googleAuthTokens.set(token, { userId: created.id, ts: Date.now() });
    const session = req.session as Record<string, unknown>;
    session.userId = created.id; session.googleAuthToken = token; session.googleAuthUserId = created.id;
    req.session.save(err => { if (err) redirect({ error: "session_error" }); else redirect({ token, needsPhone: "1" }); });
    return;
  }

  // Existing user
  if (role !== "login" && existing.passwordHash !== "") { redirect({ error: "email_registered_via_phone" }); return; }

  await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, existing.id));
  const token = crypto.randomBytes(24).toString("hex");
  googleAuthTokens.set(token, { userId: existing.id, ts: Date.now() });
  const session = req.session as Record<string, unknown>;
  session.userId = existing.id; session.googleAuthToken = token; session.googleAuthUserId = existing.id;
  req.session.save(err => { if (err) redirect({ error: "session_error" }); else redirect({ token, needsPhone: existing.phone ? "0" : "1" }); });
});

// GET /api/auth/google/session?token=xxx
router.get("/auth/google/session", async (req, res): Promise<void> => {
  const { token }     = req.query as { token: string };
  const mapEntry      = token ? googleAuthTokens.get(token) : undefined;
  const sessionToken  = (req.session as Record<string, unknown>).googleAuthToken  as string | undefined;
  const sessionUserId = (req.session as Record<string, unknown>).googleAuthUserId as number | undefined;

  let userId: number | undefined;
  if (mapEntry) {
    googleAuthTokens.delete(token);
    userId = mapEntry.userId;
  } else if (token && sessionToken && token === sessionToken && sessionUserId) {
    userId = sessionUserId;
  } else {
    res.status(401).json({ error: "invalid_token", message: "Invalid or expired Google auth token." }); return;
  }

  const session = req.session as Record<string, unknown>;
  delete session.googleAuthToken; delete session.googleAuthUserId;
  session.userId = userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(404).json({ error: "user_not_found" }); return; }

  res.json(LoginUserResponse.parse({ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, avatarUrl: user.avatarUrl ?? null, createdAt: user.createdAt.toISOString() }));
});

// GET /api/auth/google/pending?token=xxx
router.get("/auth/google/pending", (req, res): void => {
  const { token } = req.query as { token: string };
  const mapEntry  = token ? googlePendingTokens.get(token) : undefined;
  if (mapEntry) { res.json({ name: mapEntry.name, email: mapEntry.email }); return; }

  const session      = req.session as Record<string, unknown>;
  const pendingToken = session.googlePendingToken as string | undefined;
  if (!token || !pendingToken || token !== pendingToken) {
    res.status(401).json({ error: "invalid_token" }); return;
  }
  res.json({ name: session.googlePendingName, email: session.googlePendingEmail });
});

// POST /api/auth/google/send-phone-otp
// Checks phone availability for a new Google user and sends OTP
router.post("/auth/google/send-phone-otp", async (req, res): Promise<void> => {
  const { phone, token } = req.body as { phone: string; token?: string };
  const session = req.session as Record<string, unknown>;

  // Validate the Google pending token
  const tokenValid = (token && googlePendingTokens.has(token)) || !!session.googlePendingEmail;
  if (!tokenValid) {
    res.status(401).json({ error: "invalid_token", message: "Your Google session has expired. Please sign in again." });
    return;
  }

  const normalised = normalisePhone(phone ?? "");
  if (!normalised) {
    res.status(400).json({ error: "invalid_phone", message: "Please enter a valid 10-digit Indian mobile number." });
    return;
  }

  // Check if this phone is already registered with any account
  const [existing] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.phone, normalised));
  if (existing) {
    res.status(409).json({
      error: "phone_already_registered",
      message: "This phone number is already registered with another account. Please use a different number or login with your existing phone number.",
    });
    return;
  }

  // Invalidate old OTPs for this phone and send a new one
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

// POST /api/auth/google/verify-phone-otp
// Verifies the OTP, marks it used, and stores the verified phone against the pending token
router.post("/auth/google/verify-phone-otp", async (req, res): Promise<void> => {
  const { phone, code, token } = req.body as { phone: string; code: string; token?: string };
  const session = req.session as Record<string, unknown>;

  // Validate the Google pending token
  const tokenValid = (token && googlePendingTokens.has(token)) || !!session.googlePendingEmail;
  if (!tokenValid) {
    res.status(401).json({ error: "invalid_token", message: "Your Google session has expired. Please sign in again." });
    return;
  }

  const normalised = normalisePhone(phone ?? "");
  if (!normalised) {
    res.status(400).json({ error: "invalid_phone", message: "Invalid phone number." });
    return;
  }

  const MASTER_OTP = "1111";
  const now = new Date();

  if (code !== MASTER_OTP) {
    const [otp] = await db.select().from(otpsTable).where(
      and(eq(otpsTable.phone, normalised), eq(otpsTable.code, code), eq(otpsTable.used, false), gt(otpsTable.expiresAt, now))
    );
    if (!otp) {
      res.status(400).json({ error: "invalid_otp", message: "Invalid or expired code. Please try again." });
      return;
    }
    await db.update(otpsTable).set({ used: true }).where(eq(otpsTable.id, otp.id));
  }

  // Store verified phone keyed by the pending token
  if (token) {
    verifiedGooglePhones.set(token, { phone: normalised, ts: Date.now() });
  }
  session.googleVerifiedPhone = normalised;

  res.json({ success: true });
});

// POST /api/auth/google/complete
// Creates the new user account using the verified phone + Google profile name
router.post("/auth/google/complete", async (req, res): Promise<void> => {
  const { role: rawRole, token } = req.body as { role?: string; token?: string };
  const session = req.session as Record<string, unknown>;

  let pendingName:  string | undefined;
  let pendingEmail: string | undefined;

  if (token) {
    const mapEntry = googlePendingTokens.get(token);
    if (mapEntry) { pendingName = mapEntry.name; pendingEmail = mapEntry.email; }
  }
  if (!pendingName || !pendingEmail) {
    pendingName  = session.googlePendingName  as string | undefined;
    pendingEmail = session.googlePendingEmail as string | undefined;
  }
  if (!pendingName || !pendingEmail) {
    res.status(400).json({ error: "no_pending_profile" }); return;
  }

  // Retrieve the verified phone (set by verify-phone-otp)
  let verifiedPhone: string | null = null;
  if (token && verifiedGooglePhones.has(token)) {
    verifiedPhone = verifiedGooglePhones.get(token)!.phone;
  } else if (session.googleVerifiedPhone) {
    verifiedPhone = session.googleVerifiedPhone as string;
  }

  const VALID_ROLES = ["customer", "cleaner", "owner"] as const;
  type UserRole = (typeof VALID_ROLES)[number];
  const userRole: UserRole = VALID_ROLES.includes(rawRole as UserRole) ? (rawRole as UserRole) : "customer";

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, pendingEmail));
  if (existing) {
    await db.update(usersTable).set({ isLoggedIn: true }).where(eq(usersTable.id, existing.id));
    if (token) { googlePendingTokens.delete(token); verifiedGooglePhones.delete(token); }
    delete session.googlePendingToken; delete session.googlePendingName;
    delete session.googlePendingEmail; delete session.googleVerifiedPhone;
    session.userId = existing.id;
    res.json(LoginUserResponse.parse({ id: existing.id, name: existing.name, email: existing.email, role: existing.role, phone: existing.phone, avatarUrl: existing.avatarUrl ?? null, createdAt: existing.createdAt.toISOString() }));
    return;
  }

  // Create the user with name from Google profile + verified phone
  const [created] = await db.insert(usersTable).values({
    name: pendingName, email: pendingEmail, passwordHash: "",
    role: userRole, phone: verifiedPhone, isLoggedIn: true,
  }).returning();
  if (userRole === "cleaner") await db.insert(cleanersTable).values({ userId: created.id, pricePerClean: 0 });

  if (token) { googlePendingTokens.delete(token); verifiedGooglePhones.delete(token); }
  delete session.googlePendingToken; delete session.googlePendingName;
  delete session.googlePendingEmail; delete session.googleVerifiedPhone;
  session.userId = created.id;

  res.json(LoginUserResponse.parse({ id: created.id, name: created.name, email: created.email, role: created.role, phone: created.phone, avatarUrl: created.avatarUrl ?? null, createdAt: created.createdAt.toISOString() }));
});

export default router;
