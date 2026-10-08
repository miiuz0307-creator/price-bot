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

router.get("/targets", async (req, res, next) => {
  try {
    const rows = await db.select().from(priceBotTargets).where(eq(priceBotTargets.adminId, req.authAdmin!.id)).orderBy(desc(priceBotTargets.addedAt));
    res.json(ListTargetsResponse.parse(rows.map(targetDto)));
  } catch (error) {
    next(error);
  }
});

router.post("/targets", async (req, res, next) => {
  try {
    const data = CreateTargetBody.parse(req.body);
    const [row] = await db
      .insert(priceBotTargets)
      .values({ adminId: req.authAdmin!.id, kind: data.kind, identifier: normalizeIdentifier(data.identifier, data.kind), label: data.label })
      .onConflictDoUpdate({
        target: [priceBotTargets.adminId, priceBotTargets.identifier],
        set: { kind: data.kind, label: data.label, active: true },
      })
      .returning();
    res.status(201).json(CreateTargetResponse.parse(targetDto(row)));
  } catch (error) {
    next(error);
  }
});

router.patch("/targets/:id", async (req, res, next) => {
  try {
    const { id } = UpdateTargetParams.parse(req.params);
    const data = UpdateTargetBody.parse(req.body);
    const [current] = await db.select().from(priceBotTargets).where(and(eq(priceBotTargets.id, id), eq(priceBotTargets.adminId, req.authAdmin!.id)));
    if (!current) {
      res.status(404).json({ error: "היעד לא נמצא" });
      return;
    }
    const [row] = await db
      .update(priceBotTargets)
      .set({ label: data.label ?? current.label, active: data.active ?? current.active })
      .where(and(eq(priceBotTargets.id, id), eq(priceBotTargets.adminId, req.authAdmin!.id)))
      .returning();
    res.json(UpdateTargetResponse.parse(targetDto(row)));
  } catch (error) {
    next(error);
  }
});

router.delete("/targets/:id", async (req, res, next) => {
  try {
    const { id } = DeleteTargetParams.parse(req.params);
    await db.delete(priceBotTargets).where(and(eq(priceBotTargets.id, id), eq(priceBotTargets.adminId, req.authAdmin!.id)));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
