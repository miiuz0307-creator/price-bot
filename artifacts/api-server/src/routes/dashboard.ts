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
  PairWhatsAppBody,
  PairWhatsAppResponse,
  GetSystemOverviewResponse,
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
import { auditEntries } from "./team";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const [products, admins, lookups, recent] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${priceBotProducts.active})::int` }).from(priceBotProducts),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotAdmins).where(eq(priceBotAdmins.active, true)),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotLookups).where(eq(priceBotLookups.adminId, workspaceId(req.authAdmin!))),
      db.select({ createdAt: priceBotLookups.createdAt }).from(priceBotLookups).where(eq(priceBotLookups.adminId, workspaceId(req.authAdmin!))).orderBy(desc(priceBotLookups.createdAt)).limit(1),
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
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.getStatus(workspaceId(req.authAdmin!), req.authAdmin!.role === "owner" && !req.authAdmin!.whatsappOwnerId)));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/connect", requirePermission("whatsapp.manage"), async (req, res, next) => {
  try {
    await audit(req, "whatsapp.connect_started", { type: "workspace", id: workspaceId(req.authAdmin!) }, { method: "qr" });
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.connectFresh(workspaceId(req.authAdmin!))));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/pair", requirePermission("whatsapp.manage"), async (req, res, next) => {
  try {
    const { phoneNumber } = PairWhatsAppBody.parse(req.body);
    let status;
    try {
      status = await whatsappWeb.connectWithPairingCode(workspaceId(req.authAdmin!), phoneNumber);
    } catch {
      res.status(400).json({ error: "מספר הטלפון אינו תקין. הזינו את המספר של חשבון ה־WhatsApp שמחברים." });
      return;
    }
    await audit(req, "whatsapp.connect_started", { type: "workspace", id: workspaceId(req.authAdmin!) }, { method: "pairing_code" });
    res.json(PairWhatsAppResponse.parse(status));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/disconnect", requirePermission("whatsapp.manage"), async (req, res, next) => {
  try {
    await audit(req, "whatsapp.disconnect", { type: "workspace", id: workspaceId(req.authAdmin!) });
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.disconnect(workspaceId(req.authAdmin!))));
  } catch (error) {
    next(error);
  }
});

router.get("/integration/whatsapp/groups", async (req, res, next) => {
  try {
    const [groups, savedGroups] = await Promise.all([
      whatsappWeb.listGroups(workspaceId(req.authAdmin!)),
      db.select().from(priceBotTargets).where(and(eq(priceBotTargets.kind, "group"), eq(priceBotTargets.adminId, workspaceId(req.authAdmin!)))),
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

router.get("/system/overview", requirePermission("users.manage"), async (_req, res, next) => {
  try {
    const now = new Date();
    const [users, pending, surges, problems] = await Promise.all([
      db.select().from(priceBotAdmins),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotLookups).where(eq(priceBotLookups.matched, false)),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotSurgeSettings).where(eq(priceBotSurgeSettings.active, true)),
      auditEntries(20, { problemsOnly: true }),
    ]);
    const workspaces = users.filter((user) => user.active && user.whatsappOwnerId === null);
    const connections = await Promise.all(workspaces.map(async (user) => {
      const status = await whatsappWeb.getStatus(user.id);
      return {
        adminId: user.id, label: user.label, connected: status.connected, connectionState: status.connectionState,
        phoneNumber: status.phoneNumber, lastError: status.lastError,
        sharedUsers: users.filter((member) => member.active && member.whatsappOwnerId === user.id).length,
      };
    }));
    void now;
    res.json(GetSystemOverviewResponse.parse({
      activeUsers: users.filter((user) => user.active).length,
      suspendedUsers: users.filter((user) => !user.active).length,
      connections,
      pendingLookups: pending[0]?.total ?? 0,
      activeSurges: surges[0]?.total ?? 0,
      recentProblems: problems,
    }));
  } catch (error) {
    next(error);
  }
});

export default router;
