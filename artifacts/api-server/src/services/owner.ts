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


export const primaryOwnerPhone = "0504107826";
export const primaryOwnerLabel = "מיכאל";

// Setting the very first owner code from the website means "whoever opens the site
// first becomes the owner". In production that is only allowed when explicitly
// enabled; the safe way is OWNER_INITIAL_CODE, applied once at startup.
export function ownerBootstrapAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_OWNER_BOOTSTRAP === "1";
}

export async function getOrCreateOwnerAdmin() {
  const [existingOwner] = await db
    .select()
    .from(priceBotAdmins)
    .where(eq(priceBotAdmins.phone, primaryOwnerPhone))
    .limit(1);
  if (existingOwner?.role === "owner" && existingOwner.active) {
    await assignLegacyRowsToOwner(existingOwner.id);
    return existingOwner;
  }

  const [owner] = await db
    .insert(priceBotAdmins)
    .values({ phone: primaryOwnerPhone, label: primaryOwnerLabel, role: "owner", active: true })
    .onConflictDoUpdate({
      target: priceBotAdmins.phone,
      set: { label: primaryOwnerLabel, role: "owner", active: true },
    })
    .returning();
  await assignLegacyRowsToOwner(owner.id);
  return owner;
}

let legacyRowsAssigned = false;
export async function assignLegacyRowsToOwner(ownerId: number) {
  if (legacyRowsAssigned) return;
  await Promise.all([
    db.update(priceBotTargets).set({ adminId: ownerId }).where(isNull(priceBotTargets.adminId)),
    db.update(priceBotLookups).set({ adminId: ownerId }).where(isNull(priceBotLookups.adminId)),
  ]);
  legacyRowsAssigned = true;
}
