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

router.get("/admins", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotAdmins).orderBy(desc(priceBotAdmins.addedAt));
    res.json(ListAdminsResponse.parse(rows.map(adminDto)));
  } catch (error) {
    next(error);
  }
});

router.post("/admins", requireOwner, async (req, res, next) => {
  try {
    const data = CreateAdminBody.parse(req.body);
    const [row] = await db
      .insert(priceBotAdmins)
      .values({ phone: data.phone, label: data.label ?? "מנהל" })
      .onConflictDoUpdate({
        target: priceBotAdmins.phone,
        set: { label: data.label ?? "מנהל", active: true },
      })
      .returning();
    res.status(201).json(CreateAdminResponse.parse(adminDto(row)));
  } catch (error) {
    next(error);
  }
});

router.delete("/admins/:id", requireOwner, async (req, res, next) => {
  try {
    const { id } = DeleteAdminParams.parse(req.params);
    const [admin] = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.id, id));
    if (admin?.role === "owner") {
      res.status(403).json({ error: "לא ניתן למחוק את בעל המערכת" });
      return;
    }
    await db.delete(priceBotAdmins).where(eq(priceBotAdmins.id, id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.put("/admins/:id/code", requireOwner, async (req, res, next) => {
  try {
    const { id } = SetAdminCodeParams.parse(req.params);
    const data = SetAdminCodeBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    if (id === req.authAdmin!.id) {
      res.status(403).json({ error: "לא ניתן לשנות את הקוד האישי דרך פעולה זו" });
      return;
    }
    const [admin] = await db.update(priceBotAdmins).set({ codeHash: await hashCode(data.code) }).where(eq(priceBotAdmins.id, id)).returning();
    if (!admin) {
      res.status(404).json({ error: "המנהל לא נמצא" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
