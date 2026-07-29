/**
 * Shared Express Middleware
 * Common middleware used across multiple services.
 * Import the helpers you need rather than requiring the whole module.
 */
import type { Request, Response, NextFunction } from "express";

/** Rejects unauthenticated requests with 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/** Rejects non-admin requests with 403. */
export function adminOnly(req: Request, res: Response, next: NextFunction): void {
  const session = req.session as Record<string, unknown>;
  if (!session.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/** Helper to extract userId from a session (throws if not present). */
export function getSessionUserId(req: Request): number {
  const userId = (req.session as Record<string, unknown>).userId as number | undefined;
  if (!userId) throw new Error("Not authenticated");
  return userId;
}
