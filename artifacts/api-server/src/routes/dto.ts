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


// The web forms used to send "₪" while the bot and surge matching expect "ILS".
// Store one canonical code so every product takes part in surge pricing.
export function normalizeCurrency(value: string | undefined | null) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "₪" || /^(ils|nis)$/iu.test(trimmed) || /^ש["״'׳]?ח$/u.test(trimmed) || trimmed === "שקל") return "ILS";
  return trimmed.toUpperCase();
}

export function productDto(row: typeof priceBotProducts.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    currency: row.currency,
    aliases: row.aliases,
    distance: row.distance,
    duration: row.duration,
    level: row.level,
    priceMatrix: row.priceMatrix,
    waitTime: row.waitTime,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function adminDto(row: typeof priceBotAdmins.$inferSelect) {
  return {
    id: row.id,
    phone: row.phone,
    label: row.label,
    role: row.role === "owner" ? "owner" : "admin",
    active: row.active,
    addedAt: row.addedAt.toISOString(),
  };
}

export function targetDto(row: typeof priceBotTargets.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind === "group" ? "group" : "contact",
    identifier: row.identifier,
    label: row.label,
    active: row.active,
    addedAt: row.addedAt.toISOString(),
  };
}

export function lookupRequestDto(row: typeof priceBotLookups.$inferSelect) {
  return {
    id: row.id,
    query: row.body.replace(/^מ\s*/u, "").trim() || row.body,
    from: row.from,
    createdAt: row.createdAt.toISOString(),
    estimate: row.estimate ?? null,
  };
}
