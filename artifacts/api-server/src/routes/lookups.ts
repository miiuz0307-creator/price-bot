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

router.get("/lookup-requests", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(priceBotLookups)
      .where(and(eq(priceBotLookups.matched, false), eq(priceBotLookups.adminId, workspaceId(req.authAdmin!))))
      .orderBy(desc(priceBotLookups.createdAt))
      .limit(20);
    res.json(ListLookupRequestsResponse.parse(rows.map(lookupRequestDto)));
  } catch (error) {
    next(error);
  }
});

router.delete("/lookup-requests/:id", requirePermission("lookups.manage"), async (req, res, next) => {
  try {
    const { id } = DeleteLookupRequestParams.parse(req.params);
    await db.delete(priceBotLookups).where(and(eq(priceBotLookups.id, id), eq(priceBotLookups.adminId, workspaceId(req.authAdmin!))));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/lookup-requests/:id/approve", requirePermission("lookups.manage"), async (req, res, next) => {
  try {
    const { id } = ApproveLookupEstimateParams.parse(req.params);
    const outcome = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(priceBotLookups)
        .where(and(eq(priceBotLookups.id, id), eq(priceBotLookups.adminId, workspaceId(req.authAdmin!))))
        .for("update");
      if (!request?.estimate) return { status: 404 as const };
      const { name, distanceKm, priceMatrix, waitTime } = request.estimate;
      if (!name || !Number.isFinite(distanceKm) || distanceKm <= 0
        || priceMatrix.length !== 8 || priceMatrix.some((price) => !Number.isFinite(price) || price <= 0))
        return { status: 422 as const };

      const variants = normalizedSearchVariants(name);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${[...variants].sort().join("|")}))`);
      const existing = await tx.select().from(priceBotProducts);
      if (existing.some((product) => [product.name, ...product.aliases].some((candidate) =>
        normalizedSearchVariants(candidate).some((variant) => variants.includes(variant)),
      ))) return { status: 409 as const };

      const [product] = await tx.insert(priceBotProducts).values({
        name,
        price: String(priceMatrix[0]),
        currency: "ILS",
        aliases: [request.body.replace(/^מ\s*/u, "").trim()].filter((alias) => alias && alias !== name),
        distance: `${distanceKm.toLocaleString("he-IL", { maximumFractionDigits: 1 })} ק״מ`,
        level: "אושר על ידי מנהל",
        priceMatrix,
        waitTime: waitTime ?? "",
        active: true,
      }).returning();
      await tx.delete(priceBotLookups).where(eq(priceBotLookups.id, id));
      return { status: 201 as const, product };
    });
    if (outcome.status !== 201) {
      res.status(outcome.status).json({ error: outcome.status === 409
        ? "המסלול כבר קיים במחירון. לא שיניתי מחירים קיימים."
        : outcome.status === 422 ? "ההערכה אינה תקינה ואי אפשר לאשר אותה." : "לא נמצאה הערכה ממתינה לאישור." });
      return;
    }
    void audit(req, "lookup.approve", { type: "product", id: outcome.product.id }, { label: outcome.product.name, priceMatrix: outcome.product.priceMatrix });
    res.status(201).json(ApproveLookupEstimateResponse.parse(productDto(outcome.product)));
  } catch (error) {
    next(error);
  }
});

export default router;
