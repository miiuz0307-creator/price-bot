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

import { sessionCookieName, sessionLifetimeMs, scrypt, hashCode, verifyCode, validCode, loginKeys, loginRetryAfterSeconds, recordLoginFailure, rejectIfLoginBlocked, loginFailures, sendSession, endCurrentSession, revokeAllSessions, requireAdmin, requireOwner, requirePermission, hasPermission, effectivePermissions, isPermission, allPermissions, workspaceId, type Permission, type AuthAdmin } from "../auth/admin-auth";
import { normalizePhone, normalizeIdentifier } from "../lib/identifiers";
import { findClosestProduct } from "../bot/search";
import { messageCredit, messageHeader, formatProductResponse, formatHourlyPricingResponse, formatExtrasResponse } from "../bot/replies";
import { normalizeCurrency, productDto, adminDto, targetDto, lookupRequestDto } from "./dto";
import { primaryOwnerPhone, primaryOwnerLabel, ownerBootstrapAllowed, getOrCreateOwnerAdmin } from "../services/owner";

import { audit } from "../services/audit";

const router: IRouter = Router();

export async function surgeStatus(adminId: number) {
  const now = new Date();
  const [settings, offers, products, groups, connection] = await Promise.all([
    db.select().from(priceBotSurgeSettings).where(eq(priceBotSurgeSettings.adminId, adminId)).then((rows) => rows[0]),
    db.select().from(priceBotSurgeOffers).where(and(eq(priceBotSurgeOffers.adminId, adminId), gt(priceBotSurgeOffers.expiresAt, now))).orderBy(desc(priceBotSurgeOffers.observedAt)),
    db.select({
      id: priceBotProducts.id, name: priceBotProducts.name, active: priceBotProducts.active,
      price: priceBotProducts.price, priceMatrix: priceBotProducts.priceMatrix,
    }).from(priceBotProducts),
    whatsappWeb.listGroups(adminId),
    whatsappWeb.getStatus(adminId),
  ]);
  const productById = new Map(products.filter((row) => row.active).map((row) => [row.id, row]));
  const groupById = new Map(groups.map((group) => [group.identifier, group.label]));
  return GetSurgeStatusResponse.parse({
    active: settings?.active ?? false,
    connected: connection.connected,
    groupIdentifiers: settings?.groupIdentifiers ?? [],
    offers: settings?.active ? offers.filter((row) =>
      row.observedAt >= settings.startedAt && productById.has(row.productId)
      && !!row.directionKey && isSurgeActiveAt(row, now) && isSurgeAboveCatalog(row, productById.get(row.productId)!)).map((row) => ({
      id: row.id, productId: row.productId, route: row.quotedRoute,
      price: row.price, vehicleType: row.vehicleType, extraPassenger: row.extraPassenger,
      groupIdentifier: row.groupIdentifier, groupLabel: groupById.get(row.groupIdentifier) ?? row.groupIdentifier,
      observedAt: row.observedAt.toISOString(), expiresAt: surgeEffectiveExpiry(row).toISOString(),
    })) : [],
  });
}

router.get("/surge", async (req, res, next) => {
  try { res.json(await surgeStatus(workspaceId(req.authAdmin!))); } catch (error) { next(error); }
});

router.post("/surge/start", requirePermission("surge.manage"), async (req, res, next) => {
  try {
    const input = StartSurgeMonitoringBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "בחרו לפחות קבוצת WhatsApp אחת." }); return; }
    const identifiers = [...new Set(input.data.groupIdentifiers)];
    const connection = await whatsappWeb.getStatus(workspaceId(req.authAdmin!));
    if (!connection.connected) { res.status(409).json({ error: "חברו את WhatsApp לפני הפעלת זמני עומס." }); return; }
    const groups = await whatsappWeb.listGroups(workspaceId(req.authAdmin!));
    const available = new Set(groups.map((group) => group.identifier));
    if (!identifiers.length || identifiers.some((identifier) => !available.has(identifier))) {
      res.status(400).json({ error: "יש לבחור קבוצות שהבוט מחובר אליהן." }); return;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(priceBotSurgeSettings)
        .values({ adminId: workspaceId(req.authAdmin!), active: true, groupIdentifiers: identifiers, startedAt: now })
        .onConflictDoUpdate({ target: priceBotSurgeSettings.adminId, set: { active: true, groupIdentifiers: identifiers, startedAt: now } });
      await tx.update(priceBotSurgeOffers).set({ expiresAt: now }).where(eq(priceBotSurgeOffers.adminId, workspaceId(req.authAdmin!)));
    });
    void audit(req, "surge.start", { type: "workspace", id: workspaceId(req.authAdmin!) }, { groups: identifiers.length });
    res.json(StartSurgeMonitoringResponse.parse(await surgeStatus(workspaceId(req.authAdmin!))));
  } catch (error) { next(error); }
});

router.post("/surge/stop", requirePermission("surge.manage"), async (req, res, next) => {
  try {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(priceBotSurgeSettings).set({ active: false }).where(eq(priceBotSurgeSettings.adminId, workspaceId(req.authAdmin!)));
      await tx.update(priceBotSurgeOffers).set({ expiresAt: now }).where(eq(priceBotSurgeOffers.adminId, workspaceId(req.authAdmin!)));
    });
    void audit(req, "surge.stop", { type: "workspace", id: workspaceId(req.authAdmin!) });
    res.json(StopSurgeMonitoringResponse.parse(await surgeStatus(workspaceId(req.authAdmin!))));
  } catch (error) { next(error); }
});

export default router;
