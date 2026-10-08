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

router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const [products, admins, lookups, recent] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${priceBotProducts.active})::int` }).from(priceBotProducts),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotAdmins).where(eq(priceBotAdmins.active, true)),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotLookups).where(eq(priceBotLookups.adminId, req.authAdmin!.id)),
      db.select({ createdAt: priceBotLookups.createdAt }).from(priceBotLookups).where(eq(priceBotLookups.adminId, req.authAdmin!.id)).orderBy(desc(priceBotLookups.createdAt)).limit(1),
    ]);
    res.json(GetDashboardSummaryResponse.parse({
      productCount: products[0]?.total ?? 0,
      activeProductCount: products[0]?.active ?? 0,
      adminCount: admins[0]?.total ?? 0,
      lookupCount: lookups[0]?.total ?? 0,
      lastLookupAt: recent[0]?.createdAt?.toISOString() ?? null,
    }));
  } catch (error) {
    next(error);
  }
});

router.get("/integration/whatsapp", async (req, res, next) => {
  try {
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.getStatus(req.authAdmin!.id, req.authAdmin!.role === "owner")));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/connect", async (req, res, next) => {
  try {
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.connectFresh(req.authAdmin!.id)));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/disconnect", async (req, res, next) => {
  try {
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.disconnect(req.authAdmin!.id)));
  } catch (error) {
    next(error);
  }
});

router.get("/integration/whatsapp/groups", async (req, res, next) => {
  try {
    const [groups, savedGroups] = await Promise.all([
      whatsappWeb.listGroups(req.authAdmin!.id),
      db.select().from(priceBotTargets).where(and(eq(priceBotTargets.kind, "group"), eq(priceBotTargets.adminId, req.authAdmin!.id))),
    ]);
    const savedLabels = new Map(
      savedGroups.map((group) => [normalizeIdentifier(group.identifier, "group"), group.label]),
    );
    res.json(ListWhatsAppGroupsResponse.parse(groups.map((group) => ({
      ...group,
      label: group.label === "קבוצה ללא שם"
        ? savedLabels.get(normalizeIdentifier(group.identifier, "group")) || group.label
        : group.label,
    }))));
  } catch (error) {
    next(error);
  }
});

export default router;
