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


export function levenshteinDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const next = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      previous = next;
    }
  }
  return row[right.length];
}

export type ProductSearchResult =
  | { kind: "match"; product: typeof priceBotProducts.$inferSelect; corrected: boolean }
  | { kind: "ambiguous"; suggestions: string[] }
  | { kind: "needs_route" }
  | null;

export function findClosestProduct(rows: (typeof priceBotProducts.$inferSelect)[], query: string, allowFuzzy = true): ProductSearchResult {
  const queryVariants = normalizedSearchVariants(query);
  const normalizedQuery = queryVariants[0];
  if (!normalizedQuery) return null;
  if (normalizedQuery.length < 7) return { kind: "needs_route" };
  const exactMatches = new Map<number, typeof priceBotProducts.$inferSelect>();
  for (const product of rows) {
    if ([product.name, ...product.aliases].some((candidate) =>
      normalizedSearchVariants(candidate).some((variant) => queryVariants.includes(variant)),
    )) {
      exactMatches.set(product.id, product);
    }
  }
  if (exactMatches.size === 1) return { kind: "match", product: [...exactMatches.values()][0], corrected: false };
  if (exactMatches.size > 1) {
    const matches = [...exactMatches.values()];
    const directNameMatches = matches.filter((product) =>
      normalizedSearchVariants(product.name).some((variant) => queryVariants.includes(variant)),
    );
    if (directNameMatches.length === 1) {
      return { kind: "match", product: directNameMatches[0], corrected: false };
    }
    if (directNameMatches.length > 1) {
      const newest = [...directNameMatches].sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      )[0];
      return { kind: "match", product: newest, corrected: false };
    }
    const signatures = new Set(matches.map((product) => JSON.stringify({
      name: normalizeSearchText(product.name),
      priceMatrix: product.priceMatrix,
      distance: product.distance,
      duration: product.duration,
      level: product.level,
      waitTime: product.waitTime,
    })));
    if (signatures.size === 1) return { kind: "match", product: matches[0], corrected: false };
    return { kind: "ambiguous", suggestions: [...new Set(matches.map((product) => product.name))].slice(0, 3) };
  }
  if (!allowFuzzy) return null;

  const candidates = new Map<number, { product: typeof priceBotProducts.$inferSelect; score: number; distance: number }>();

  for (const product of rows) {
    for (const candidate of [product.name, ...product.aliases.filter((alias) => normalizeSearchText(alias).length >= 7)]) {
      const candidateScores = normalizedSearchVariants(candidate)
        .filter(Boolean)
        .map((normalizedCandidate) => {
          const distance = levenshteinDistance(normalizedQuery, normalizedCandidate);
          const similarity = 1 - distance / Math.max(normalizedQuery.length, normalizedCandidate.length);
          const score = (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate))
            && Math.abs(normalizedCandidate.length - normalizedQuery.length) <= 2
            ? Math.max(similarity, 0.9)
            : similarity;
          return { score, distance };
        });
      const bestCandidate = candidateScores.sort((left, right) => right.score - left.score)[0];
      if (!bestCandidate) continue;
      const { score, distance } = bestCandidate;
      const current = candidates.get(product.id);
      if (!current || score > current.score) candidates.set(product.id, { product, score, distance });
    }
  }

  const ranked = [...candidates.values()].sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const second = ranked[1];
  const maxDistance = normalizedQuery.length >= 10 ? 2 : 1;
  const threshold = normalizedQuery.length >= 10 ? 0.82 : 0.88;
  if (!best || best.distance > maxDistance || best.score < threshold) return null;
  if (second && best.score - second.score < 0.08) {
    return { kind: "ambiguous", suggestions: ranked.slice(0, 3).map((candidate) => candidate.product.name) };
  }
  return { kind: "match", product: best.product, corrected: true };
}
