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
  LoginWithPinBody,
  RequestLoginCodeBody,
  RequestLoginCodeResponse,
  VerifyLoginCodeBody,
  VerifyLoginCodeResponse,
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

import { sessionCookieName, sessionLifetimeMs, scrypt, hashCode, verifyCode, validCode, loginKeys, loginRetryAfterSeconds, recordLoginFailure, rejectIfLoginBlocked, loginFailures, sendSession, endCurrentSession, revokeAllSessions, requireAdmin, requireOwner, requirePermission, hasPermission, effectivePermissions, isPermission, allPermissions, workspaceId, type Permission, type AuthAdmin } from "../auth/admin-auth";
import { normalizePhone, normalizeIdentifier } from "../lib/identifiers";
import { findClosestProduct } from "../bot/search";
import { messageCredit, messageHeader, formatProductResponse, formatHourlyPricingResponse, formatExtrasResponse } from "../bot/replies";
import { normalizeCurrency, productDto, adminDto, targetDto, lookupRequestDto } from "./dto";
import { primaryOwnerPhone, primaryOwnerLabel, ownerBootstrapAllowed, getOrCreateOwnerAdmin } from "../services/owner";

import { audit } from "../services/audit";
import { findUserByIdentifier, requestLoginCode, verifyLoginCode } from "../services/login-codes";

const router: IRouter = Router();

const unknownCodeMessage = "קוד שגוי או שפג תוקפו. בקשו קוד חדש.";

router.get("/auth/admins", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.active, true)).orderBy(priceBotAdmins.addedAt);
    res.json(ListLoginAdminsResponse.parse(rows.map((row) => ({ id: row.id, label: row.label, role: row.role === "owner" ? "owner" : "admin" }))));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/status", async (_req, res, next) => {
  try {
    const owner = await getOrCreateOwnerAdmin();
    res.json(GetAuthStatusResponse.parse({ ownerSetupRequired: Boolean(owner && !owner.codeHash && ownerBootstrapAllowed()) }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/bootstrap", async (req, res, next) => {
  try {
    const data = BootstrapOwnerCodeBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    const owner = await getOrCreateOwnerAdmin();
    if (!owner || owner.codeHash || !ownerBootstrapAllowed()) {
      res.status(403).json({ error: "הגדרת קוד הבעלים אינה זמינה" });
      return;
    }
    const [updated] = await db.update(priceBotAdmins).set({ codeHash: await hashCode(data.code) }).where(and(eq(priceBotAdmins.id, owner.id), sql`${priceBotAdmins.codeHash} is null`)).returning();
    if (!updated) {
      res.status(403).json({ error: "הגדרת קוד הבעלים אינה זמינה" });
      return;
    }
    await sendSession(req, res, updated, "bootstrap");
    await audit(req, "auth.owner_setup", { type: "user", id: updated.id }, {}, updated.id);
    res.json(BootstrapOwnerCodeResponse.parse({ admin: adminDto(updated) }));
  } catch (error) {
    next(error);
  }
});

/** Shared PIN check for both login forms (pick-from-list and phone/email). */
async function pinLogin(req: import("express").Request, res: import("express").Response, admin: AuthAdmin | null, adminIdForLimits: number | undefined, code: string) {
  const keys = loginKeys(req, adminIdForLimits);
  if (rejectIfLoginBlocked(res, keys)) return;
  if (!admin || !admin.active || !admin.codeHash || !(await verifyCode(code, admin.codeHash))) {
    recordLoginFailure(keys);
    logger.warn({ adminId: adminIdForLimits, ip: req.ip }, "Failed administrator login");
    if (admin) await audit(req, "auth.login_failed", { type: "user", id: admin.id }, { method: "pin" }, admin.id);
    res.status(401).json({ error: "קוד אישי שגוי או גישה לא פעילה" });
    return;
  }
  for (const { key } of keys) loginFailures.delete(key);
  await sendSession(req, res, admin, "pin");
  await audit(req, "auth.login", { type: "user", id: admin.id }, { method: "pin" }, admin.id);
  res.json(LoginAdminResponse.parse({ admin: adminDto(admin) }));
}

router.post("/auth/login", async (req, res, next) => {
  try {
    const data = LoginAdminBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    const [admin] = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, data.adminId), eq(priceBotAdmins.active, true)));
    await pinLogin(req, res, admin ?? null, data.adminId, data.code);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/pin", async (req, res, next) => {
  try {
    const data = LoginWithPinBody.parse(req.body);
    const admin = await findUserByIdentifier(data.identifier);
    await pinLogin(req, res, admin, admin?.id, data.code);
  } catch (error) {
    next(error);
  }
});

router.post("/auth/code/request", async (req, res, next) => {
  try {
    const data = RequestLoginCodeBody.parse(req.body);
    // Per-address throttle shared with PIN failures, so the endpoint cannot be used to spam phones.
    const keys = loginKeys(req);
    if (rejectIfLoginBlocked(res, keys)) return;
    const outcome = await requestLoginCode(data.identifier);
    if (outcome.kind === "throttled") {
      res.status(429).json({ error: "נשלחו כבר כמה קודים. נסו שוב בעוד כמה דקות." });
      return;
    }
    if (outcome.kind === "undeliverable") {
      res.status(503).json({ error: "לא ניתן לשלוח כרגע קוד ב־WhatsApp (אין חיבור פעיל). היכנסו עם הקוד האישי או פנו לבעל המערכת." });
      return;
    }
    if (outcome.kind === "unknown") recordLoginFailure(keys);
    // Same answer whether or not the user exists, so the form cannot list members.
    res.json(RequestLoginCodeResponse.parse({ sent: true, destination: outcome.kind === "sent" ? outcome.destination : null }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/code/verify", async (req, res, next) => {
  try {
    const data = VerifyLoginCodeBody.parse(req.body);
    const keys = loginKeys(req);
    if (rejectIfLoginBlocked(res, keys)) return;
    const outcome = await verifyLoginCode(data.identifier, data.code);
    if (outcome.kind !== "ok") {
      recordLoginFailure(keys);
      if (outcome.userId) await audit(req, "auth.login_failed", { type: "user", id: outcome.userId }, { method: "whatsapp" }, outcome.userId);
      res.status(401).json({ error: unknownCodeMessage });
      return;
    }
    for (const { key } of keys) loginFailures.delete(key);
    await sendSession(req, res, outcome.user, "whatsapp");
    await audit(req, "auth.login", { type: "user", id: outcome.user.id }, { method: "whatsapp" }, outcome.user.id);
    res.json(VerifyLoginCodeResponse.parse({ admin: adminDto(outcome.user) }));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/session", requireAdmin, (req, res) => {
  res.json(GetCurrentSessionResponse.parse({ admin: adminDto(req.authAdmin!) }));
});

router.post("/auth/logout", requireAdmin, async (req, res, next) => {
  try {
    await endCurrentSession(req, res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
