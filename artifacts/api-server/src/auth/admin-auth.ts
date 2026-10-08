import { Router, type IRouter, type RequestHandler } from "express";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  sql,
} from "drizzle-orm";
import {
  CreateAdminBody,
  CreateAdminResponse,
  CreateAbbreviationBody,
  CreateAbbreviationResponse,
  CreateProductBody,
  CreateProductResponse,
  CreateTargetBody,
  CreateTargetResponse,
  BootstrapOwnerCodeBody,
  BootstrapOwnerCodeResponse,
  ApproveLookupEstimateParams,
  ApproveLookupEstimateResponse,
  DeleteAdminParams,
  DeleteAbbreviationParams,
  DeleteLookupRequestParams,
  DeleteProductParams,
  DeleteTargetParams,
  GetDashboardSummaryResponse,
  GetSurgeStatusResponse,
  GetAuthStatusResponse,
  GetCurrentSessionResponse,
  GetWhatsAppStatusResponse,
  ListAdminsResponse,
  ListAbbreviationsResponse,
  ListLoginAdminsResponse,
  LoginAdminBody,
  LoginAdminResponse,
  LogoutAdminResponse,
  ListLookupRequestsResponse,
  ListProductsResponse,
  ListTargetsResponse,
  ListWhatsAppGroupsResponse,
  ReceiveWhatsAppMessageBody,
  ReceiveWhatsAppMessageResponse,
  StartSurgeMonitoringBody,
  StartSurgeMonitoringResponse,
  StopSurgeMonitoringResponse,
  UpdateProductBody,
  UpdateAbbreviationBody,
  UpdateAbbreviationParams,
  UpdateAbbreviationResponse,
  UpdateProductParams,
  UpdateProductResponse,
  UpdateTargetBody,
  UpdateTargetParams,
  UpdateTargetResponse,
  SetAdminCodeParams,
  SetAdminCodeBody,
} from "@workspace/api-zod";
import {
  db,
  priceBotAdmins,
  priceBotSessions,
  priceBotAbbreviations,
  priceBotLookups,
  priceBotProducts,
  priceBotSurgeOffers,
  priceBotSurgeSettings,
  priceBotTargets,
} from "@workspace/db";
import { whatsappWeb, type IncomingWhatsAppMessage } from "../services/whatsapp-web";
import { expandCustomAbbreviations, isBuiltInAbbreviation, normalizeSearchText, normalizedSearchVariants } from "../services/catalog-search";
import { drivingDistanceKm, estimateReferenceRoute, estimatedPriceMatrix, estimatedWaitTime, formatRouteEstimate, isIntraCityRoute, parseUnlistedRoute, requiresManualCatalogPrice, resolveRouteAddresses } from "../services/route-estimate";
import { formatBillingCalculation, parseBillingAmount } from "../services/billing-calculator";
import { logger } from "../lib/logger";
import { formatSurgePrice, isSurgeAboveCatalog, isSurgeActiveAt, matchSurgeProduct, matchesSurgeDirection, parseSurgeQuotes, sortSurgeOffers, surgeDirectionKey, surgeEffectiveExpiry, surgeLifetimeMs } from "../services/surge-pricing";


export const scrypt = promisify(scryptCallback);
export const sessionCookieName = "price_bot_session";
export const sessionLifetimeMs = Number(process.env.SESSION_DAYS ?? 30) * 24 * 60 * 60 * 1000;


export type AuthAdmin = typeof priceBotAdmins.$inferSelect;
declare global {
  namespace Express {
    interface Request {
      authAdmin?: AuthAdmin;
    }
  }
}

export async function hashCode(code: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(code, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyCode(code: string, stored: string) {
  const [algorithm, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(code, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validCode(code: string) {
  return /^\d{4,8}$/.test(code);
}

// Personal codes are only 4-8 digits, so unlimited guessing would find one in
// minutes. Count failures per client address and per account, in memory.
const loginWindowMs = 15 * 60_000;
const maxFailuresPerAddress = 5;
const maxFailuresPerAccount = 10;
export const loginFailures = new Map<string, { count: number; resetAt: number }>();

export function loginKeys(req: import("express").Request, adminId?: number) {
  return [
    { key: `ip:${req.ip ?? "unknown"}`, limit: maxFailuresPerAddress },
    ...(adminId === undefined ? [] : [{ key: `admin:${adminId}`, limit: maxFailuresPerAccount }]),
  ];
}

export function loginRetryAfterSeconds(keys: { key: string; limit: number }[]) {
  const now = Date.now();
  let retryAfter = 0;
  for (const { key, limit } of keys) {
    const entry = loginFailures.get(key);
    if (!entry) continue;
    if (entry.resetAt <= now) { loginFailures.delete(key); continue; }
    if (entry.count >= limit) retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - now) / 1000));
  }
  return retryAfter;
}

export function recordLoginFailure(keys: { key: string }[]) {
  const now = Date.now();
  if (loginFailures.size > 10_000) {
    for (const [key, entry] of loginFailures) if (entry.resetAt <= now) loginFailures.delete(key);
  }
  for (const { key } of keys) {
    const entry = loginFailures.get(key);
    if (entry && entry.resetAt > now) entry.count += 1;
    else loginFailures.set(key, { count: 1, resetAt: now + loginWindowMs });
  }
}

export function rejectIfLoginBlocked(res: import("express").Response, keys: { key: string; limit: number }[]) {
  const retryAfter = loginRetryAfterSeconds(keys);
  if (!retryAfter) return false;
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({ error: `יותר מדי ניסיונות כניסה שגויים. נסו שוב בעוד ${Math.ceil(retryAfter / 60)} דקות.` });
  return true;
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("base64url");

/**
 * Starts a server-side session (revocable, listed per device) and sets the cookie.
 * The cookie holds a random token; the database only stores its SHA-256.
 */
export async function sendSession(
  req: import("express").Request,
  res: import("express").Response,
  admin: AuthAdmin,
  method: "pin" | "whatsapp" | "bootstrap" = "pin",
) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(priceBotSessions).values({
    tokenHash: tokenHash(token), adminId: admin.id, method,
    userAgent: (req.get("user-agent") ?? "").slice(0, 300), ip: req.ip ?? "",
    expiresAt: new Date(now.getTime() + sessionLifetimeMs),
  });
  await db.update(priceBotAdmins).set({ lastLoginAt: now, lastSeenAt: now }).where(eq(priceBotAdmins.id, admin.id));
  res.cookie(sessionCookieName, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeMs, path: "/",
  });
}

/** Ends the session behind the current request's cookie. */
export async function endCurrentSession(req: import("express").Request, res: import("express").Response) {
  const token = req.cookies?.[sessionCookieName];
  if (typeof token === "string" && token) {
    await db.update(priceBotSessions).set({ revokedAt: new Date() }).where(eq(priceBotSessions.tokenHash, tokenHash(token)));
  }
  res.clearCookie(sessionCookieName, { path: "/" });
}

/** Signs a user out everywhere (suspension, "disconnect user", lost phone). */
export async function revokeAllSessions(adminId: number) {
  await db.update(priceBotSessions).set({ revokedAt: new Date() })
    .where(and(eq(priceBotSessions.adminId, adminId), isNull(priceBotSessions.revokedAt)));
}

const touchIntervalMs = 5 * 60_000;

export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.[sessionCookieName];
    if (typeof token !== "string" || !token) {
      res.status(401).json({ error: "נדרשת התחברות" });
      return;
    }
    const now = new Date();
    const [row] = await db.select({ session: priceBotSessions, admin: priceBotAdmins })
      .from(priceBotSessions)
      .innerJoin(priceBotAdmins, eq(priceBotAdmins.id, priceBotSessions.adminId))
      .where(and(eq(priceBotSessions.tokenHash, tokenHash(token)), isNull(priceBotSessions.revokedAt), gt(priceBotSessions.expiresAt, now)));
    if (!row || !row.admin.active) {
      res.clearCookie(sessionCookieName, { path: "/" });
      res.status(401).json({ error: row ? "הגישה אינה פעילה" : "נדרשת התחברות" });
      return;
    }
    if (now.getTime() - row.session.lastSeenAt.getTime() > touchIntervalMs) {
      void Promise.all([
        db.update(priceBotSessions).set({ lastSeenAt: now }).where(eq(priceBotSessions.id, row.session.id)),
        db.update(priceBotAdmins).set({ lastSeenAt: now }).where(eq(priceBotAdmins.id, row.admin.id)),
      ]).catch(() => undefined);
    }
    req.authAdmin = row.admin;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireOwner: RequestHandler = (req, res, next) => {
  if (req.authAdmin?.role !== "owner") {
    res.status(403).json({ error: "פעולה זו זמינה לבעלים בלבד" });
    return;
  }
  next();
};

// ---- permissions ---------------------------------------------------------------

export const allPermissions = ["catalog.edit", "targets.manage", "lookups.manage", "surge.manage", "whatsapp.manage", "users.manage"] as const;
export type Permission = typeof allPermissions[number];

export function isPermission(value: string): value is Permission {
  return (allPermissions as readonly string[]).includes(value);
}

/** The owner can do everything; everyone else needs the permission granted. */
export function hasPermission(admin: AuthAdmin, permission: Permission) {
  return admin.role === "owner" || admin.permissions.includes(permission);
}

export function effectivePermissions(admin: AuthAdmin): Permission[] {
  return admin.role === "owner" ? [...allPermissions] : admin.permissions.filter(isPermission);
}

const permissionLabels: Record<Permission, string> = {
  "catalog.edit": "עריכת מחירון וקיצורים",
  "targets.manage": "ניהול יעדים",
  "lookups.manage": "טיפול בבקשות מחיר",
  "surge.manage": "הפעלת זמני עומס",
  "whatsapp.manage": "חיבור וניתוק WhatsApp",
  "users.manage": "ניהול משתמשים",
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, res, next) => {
    if (!req.authAdmin || !hasPermission(req.authAdmin, permission)) {
      res.status(403).json({ error: `אין לך הרשאה לפעולה זו (${permissionLabels[permission]}).` });
      return;
    }
    next();
  };
}

/**
 * The WhatsApp workspace a user works in: their own connection, or the
 * connection of the user who shared theirs (no second QR needed).
 * Targets, price requests, surge monitoring and groups all belong to it.
 */
export function workspaceId(admin: AuthAdmin) {
  return admin.whatsappOwnerId ?? admin.id;
}
