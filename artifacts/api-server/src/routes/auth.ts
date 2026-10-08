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

import { sessionCookieName, sessionLifetimeMs, scrypt, encodeSession, readSession, hashCode, verifyCode, validCode, loginKeys, loginRetryAfterSeconds, recordLoginFailure, rejectIfLoginBlocked, loginFailures, sendSession, requireAdmin, requireOwner, type AuthAdmin } from "../auth/admin-auth";
import { normalizePhone, normalizeIdentifier } from "../lib/identifiers";
import { findClosestProduct } from "../bot/search";
import { messageCredit, messageHeader, formatProductResponse, formatHourlyPricingResponse, formatExtrasResponse } from "../bot/replies";
import { normalizeCurrency, productDto, adminDto, targetDto, lookupRequestDto } from "./dto";
import { primaryOwnerPhone, primaryOwnerLabel, ownerBootstrapAllowed, getOrCreateOwnerAdmin } from "../services/owner";

const router: IRouter = Router();

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
    sendSession(res, updated);
    res.json(BootstrapOwnerCodeResponse.parse({ admin: adminDto(updated) }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const data = LoginAdminBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    const keys = loginKeys(req, data.adminId);
    if (rejectIfLoginBlocked(res, keys)) return;
    const [admin] = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, data.adminId), eq(priceBotAdmins.active, true)));
    if (!admin || !admin.codeHash || !(await verifyCode(data.code, admin.codeHash))) {
      recordLoginFailure(keys);
      logger.warn({ adminId: data.adminId, ip: req.ip }, "Failed administrator login");
      res.status(401).json({ error: "קוד אישי שגוי או גישה לא פעילה" });
      return;
    }
    for (const { key } of keys) loginFailures.delete(key);
    sendSession(res, admin);
    res.json(LoginAdminResponse.parse({ admin: adminDto(admin) }));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/session", requireAdmin, (req, res) => {
  res.json(GetCurrentSessionResponse.parse({ admin: adminDto(req.authAdmin!) }));
});

router.post("/auth/logout", requireAdmin, (_req, res) => {
  res.clearCookie(sessionCookieName, { path: "/" });
  res.status(204).end();
});

export default router;
