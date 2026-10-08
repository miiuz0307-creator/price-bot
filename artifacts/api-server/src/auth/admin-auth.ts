import { Router, type IRouter, type RequestHandler } from "express";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
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
export const sessionLifetimeMs = 8 * 60 * 60 * 1000;


export type AuthAdmin = typeof priceBotAdmins.$inferSelect;
declare global {
  namespace Express {
    interface Request {
      authAdmin?: AuthAdmin;
    }
  }
}

export function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured");
  return secret;
}

export function encodeSession(adminId: number) {
  const payload = Buffer.from(JSON.stringify({ adminId, exp: Date.now() + sessionLifetimeMs, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSession(value: string | undefined) {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { adminId?: number; exp?: number };
    return typeof parsed.adminId === "number" && typeof parsed.exp === "number" && parsed.exp > Date.now() ? parsed : null;
  } catch {
    return null;
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

export function sendSession(res: import("express").Response, admin: AuthAdmin) {
  res.cookie(sessionCookieName, encodeSession(admin.id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeMs, path: "/",
  });
}

export const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const session = readSession(req.cookies?.[sessionCookieName]);
    if (!session) {
      res.status(401).json({ error: "נדרשת התחברות" });
      return;
    }
    const adminId = session.adminId;
    if (typeof adminId !== "number") {
      res.status(401).json({ error: "נדרשת התחברות" });
      return;
    }
    const [admin] = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, adminId), eq(priceBotAdmins.active, true)));
    if (!admin) {
      res.clearCookie(sessionCookieName, { path: "/" });
      res.status(401).json({ error: "הגישה אינה פעילה" });
      return;
    }
    req.authAdmin = admin;
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
