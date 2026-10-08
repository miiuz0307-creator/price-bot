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

const router: IRouter = Router();

router.get("/products", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotProducts).orderBy(priceBotProducts.name);
    res.json(ListProductsResponse.parse(rows.map(productDto)));
  } catch (error) {
    next(error);
  }
});

router.post("/products", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const data = CreateProductBody.parse(req.body);
    const [row] = await db
      .insert(priceBotProducts)
      .values({
        name: data.name,
        price: String(data.price),
        currency: normalizeCurrency(data.currency),
        aliases: data.aliases ?? [data.name],
        distance: data.distance ?? "",
        duration: data.duration ?? "",
        level: data.level ?? "",
        priceMatrix: data.priceMatrix ?? [data.price],
        waitTime: data.waitTime ?? "",
        active: data.active ?? true,
      })
      .returning();
    res.status(201).json(CreateProductResponse.parse(productDto(row)));
  } catch (error) {
    next(error);
  }
});

router.patch("/products/:id", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const { id } = UpdateProductParams.parse(req.params);
    const data = UpdateProductBody.parse(req.body);
    const [current] = await db.select().from(priceBotProducts).where(eq(priceBotProducts.id, id));
    if (!current) {
      res.status(404).json({ error: "המחיר לא נמצא" });
      return;
    }
    const [row] = await db
      .update(priceBotProducts)
      .set({
        name: data.name ?? current.name,
        price: data.price === undefined ? current.price : String(data.price),
        currency: normalizeCurrency(data.currency ?? current.currency),
        aliases: data.aliases ?? current.aliases,
        distance: data.distance ?? current.distance,
        duration: data.duration ?? current.duration,
        level: data.level ?? current.level,
        priceMatrix: data.priceMatrix ?? current.priceMatrix,
        waitTime: data.waitTime ?? current.waitTime,
        active: data.active ?? current.active,
        updatedAt: new Date(),
      })
      .where(eq(priceBotProducts.id, id))
      .returning();
    res.json(UpdateProductResponse.parse(productDto(row)));
  } catch (error) {
    next(error);
  }
});

router.delete("/products/:id", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const { id } = DeleteProductParams.parse(req.params);
    await db.delete(priceBotProducts).where(eq(priceBotProducts.id, id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export function parseAbbreviation(input: { shortcut: string; expansion: string }) {
  const shortcut = input.shortcut.trim();
  const expansion = input.expansion.trim().replace(/\s+/gu, " ");
  if (!/^[\p{L}\p{N}]{2,20}$/u.test(shortcut)
    || !/^[\p{L}\p{N}][\p{L}\p{N}\s,.'׳״-]{1,79}$/u.test(expansion)
    || normalizeSearchText(shortcut) === normalizeSearchText(expansion)) return null;
  return { shortcut, expansion, normalizedShortcut: normalizeSearchText(shortcut) };
}

export function abbreviationDto(row: typeof priceBotAbbreviations.$inferSelect) {
  return { id: row.id, shortcut: row.shortcut, expansion: row.expansion, updatedAt: row.updatedAt.toISOString() };
}

export function isAbbreviationConflict(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === "23505" || value?.cause?.code === "23505";
}

router.get("/abbreviations", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotAbbreviations).orderBy(priceBotAbbreviations.shortcut);
    res.json(ListAbbreviationsResponse.parse(rows.map(abbreviationDto)));
  } catch (error) { next(error); }
});

router.post("/abbreviations", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const body = CreateAbbreviationBody.safeParse(req.body);
    const data = body.success ? parseAbbreviation(body.data) : null;
    if (!data) { res.status(400).json({ error: "הזינו קיצור בן 2–20 תווים ושם מקום מלא." }); return; }
    if (isBuiltInAbbreviation(data.shortcut)) {
      res.status(409).json({ error: "הקיצור כבר מוגדר בבוט ואי אפשר לשנותו כאן." });
      return;
    }
    const [row] = await db.insert(priceBotAbbreviations).values(data).onConflictDoNothing().returning();
    if (!row) { res.status(409).json({ error: "הקיצור כבר קיים." }); return; }
    res.status(201).json(CreateAbbreviationResponse.parse(abbreviationDto(row)));
  } catch (error) { next(error); }
});

router.patch("/abbreviations/:id", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const { id } = UpdateAbbreviationParams.parse(req.params);
    const body = UpdateAbbreviationBody.safeParse(req.body);
    const data = body.success ? parseAbbreviation(body.data) : null;
    if (!data) { res.status(400).json({ error: "הזינו קיצור בן 2–20 תווים ושם מקום מלא." }); return; }
    if (isBuiltInAbbreviation(data.shortcut)) {
      res.status(409).json({ error: "הקיצור כבר מוגדר בבוט ואי אפשר לשנותו כאן." });
      return;
    }
    const [row] = await db.update(priceBotAbbreviations)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(priceBotAbbreviations.id, id)).returning();
    if (!row) { res.status(404).json({ error: "הקיצור לא נמצא." }); return; }
    res.json(UpdateAbbreviationResponse.parse(abbreviationDto(row)));
  } catch (error) {
    if (isAbbreviationConflict(error)) { res.status(409).json({ error: "הקיצור כבר קיים." }); return; }
    next(error);
  }
});

router.delete("/abbreviations/:id", requirePermission("catalog.edit"), async (req, res, next) => {
  try {
    const { id } = DeleteAbbreviationParams.parse(req.params);
    const [row] = await db.delete(priceBotAbbreviations).where(eq(priceBotAbbreviations.id, id)).returning();
    if (!row) { res.status(404).json({ error: "הקיצור לא נמצא." }); return; }
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
