/**
 * API Gateway
 * Single mounting point for all service routers.
 * Each import is the thin HTTP layer for its domain — business logic
 * lives in the service's own service.ts / dispatcher.ts files.
 *
 * Mount order matters: more specific routes come before generic ones.
 */
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

// Services
import phoneAuthRouter   from "../services/auth/phone.router.js";
import googleAuthRouter  from "../services/auth/google.router.js";
import userRouter        from "../services/user/router.js";
import cleanerRouter     from "../services/washer/router.js";
import bookingRouter     from "../services/booking/router.js";
import feedbackRouter    from "../services/feedback/router.js";
import adminRouter       from "../services/admin/router.js";
import locationRouter    from "../services/location/router.js";
import ownerRouter       from "../services/owner/router.js";
import internalRouter    from "../services/internal/router.js";

const gateway: IRouter = Router();

// ── Health check ─────────────────────────────────────────────────────────────
gateway.get("/healthz", (_req, res) => {
  res.json(HealthCheckResponse.parse({ status: "ok" }));
});

// ── Auth ──────────────────────────────────────────────────────────────────────
gateway.use(phoneAuthRouter);
gateway.use(googleAuthRouter);

// ── Domain services ───────────────────────────────────────────────────────────
gateway.use(userRouter);
gateway.use(cleanerRouter);
gateway.use(bookingRouter);
gateway.use(feedbackRouter);
gateway.use(adminRouter);
gateway.use(locationRouter);
gateway.use(ownerRouter);
gateway.use(internalRouter);

export default gateway;
