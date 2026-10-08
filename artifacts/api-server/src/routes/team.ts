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
  UpdateAdminBody,
  UpdateAdminParams,
  UpdateAdminResponse,
  InviteAdminParams,
  InviteAdminResponse,
  RevokeAdminSessionsParams,
  ListAuditLogResponse,
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
import { sendViaAnyConnection } from "../services/login-codes";
import { priceBotAuditLog, priceBotSessions } from "@workspace/db";

const router: IRouter = Router();

const canManageUsers = (admin: AuthAdmin) => hasPermission(admin, "users.manage");

/** Rules shared by edit/suspend/delete: nobody touches the owner, only the owner grants users.manage. */
async function loadManageable(req: import("express").Request, res: import("express").Response, id: number) {
  const [target] = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.id, id));
  if (!target) {
    res.status(404).json({ error: "המשתמש לא נמצא" });
    return null;
  }
  if (target.role === "owner" && req.authAdmin!.id !== target.id) {
    res.status(403).json({ error: "לא ניתן לשנות את בעל המערכת" });
    return null;
  }
  return target;
}

function sanitizePermissions(actor: AuthAdmin, requested: string[] | undefined, current: string[] = []) {
  if (requested === undefined) return current;
  const valid = [...new Set(requested.filter(isPermission))];
  // Only the owner may hand out user management; others keep whatever the target already had.
  if (actor.role !== "owner") {
    const hadUsersManage = current.includes("users.manage");
    return [...valid.filter((permission) => permission !== "users.manage"), ...(hadUsersManage ? ["users.manage"] : [])];
  }
  return valid;
}

function normalizeEmail(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const email = value?.trim().toLowerCase() ?? "";
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ? email : false;
}

function isUniqueViolation(error: unknown) {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === "23505" || value?.cause?.code === "23505";
}

function appLink(req: import("express").Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/u, "");
  return configured || `${req.protocol}://${req.get("host")}`;
}

router.get("/admins", async (req, res, next) => {
  try {
    // Users without user management only see themselves (phones are private).
    const rows = canManageUsers(req.authAdmin!)
      ? await db.select().from(priceBotAdmins).orderBy(desc(priceBotAdmins.addedAt))
      : [req.authAdmin!];
    res.json(ListAdminsResponse.parse(rows.map(adminDto)));
  } catch (error) {
    next(error);
  }
});

router.post("/admins", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const data = CreateAdminBody.parse(req.body);
    const email = normalizeEmail(data.email);
    if (email === false) { res.status(400).json({ error: "כתובת האימייל אינה תקינה" }); return; }
    const permissions = sanitizePermissions(req.authAdmin!, data.permissions ?? ["catalog.edit", "targets.manage", "lookups.manage", "surge.manage", "whatsapp.manage"]);
    const shared = data.sharedWhatsapp ? workspaceId(req.authAdmin!) : null;
    const [row] = await db
      .insert(priceBotAdmins)
      .values({ phone: data.phone, label: data.label || "מנהל", email: email ?? null, permissions, whatsappOwnerId: shared })
      .onConflictDoUpdate({
        target: priceBotAdmins.phone,
        set: { label: data.label || "מנהל", active: true, ...(email !== undefined ? { email } : {}), permissions, whatsappOwnerId: shared },
      })
      .returning();
    await audit(req, "user.create", { type: "user", id: row.id }, { label: row.label, permissions, sharedWhatsapp: Boolean(shared) });
    res.status(201).json(CreateAdminResponse.parse(adminDto(row)));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "האימייל כבר משויך למשתמש אחר" }); return; }
    next(error);
  }
});

router.patch("/admins/:id", async (req, res, next) => {
  try {
    const { id } = UpdateAdminParams.parse(req.params);
    const data = UpdateAdminBody.parse(req.body);
    const self = req.authAdmin!.id === id;
    if (!self && !canManageUsers(req.authAdmin!)) { res.status(403).json({ error: "אין לך הרשאה לניהול משתמשים" }); return; }
    const target = await loadManageable(req, res, id);
    if (!target) return;
    // Self-service is limited to name and e-mail.
    if (self && !canManageUsers(req.authAdmin!) && (data.permissions || data.active !== undefined || data.sharedWhatsapp !== undefined || data.phone)) {
      res.status(403).json({ error: "אפשר לעדכן כאן רק שם ואימייל" }); return;
    }
    if (self && data.active === false) { res.status(400).json({ error: "לא ניתן להשעות את עצמך" }); return; }
    const email = normalizeEmail(data.email);
    if (email === false) { res.status(400).json({ error: "כתובת האימייל אינה תקינה" }); return; }
    const isOwner = target.role === "owner";
    const [row] = await db.update(priceBotAdmins).set({
      label: data.label?.trim() || target.label,
      phone: data.phone?.trim() || target.phone,
      ...(email !== undefined ? { email } : {}),
      permissions: isOwner ? target.permissions : sanitizePermissions(req.authAdmin!, data.permissions, target.permissions),
      active: isOwner ? true : data.active ?? target.active,
      whatsappOwnerId: isOwner || data.sharedWhatsapp === undefined ? target.whatsappOwnerId
        : data.sharedWhatsapp ? workspaceId(req.authAdmin!) === target.id ? null : workspaceId(req.authAdmin!) : null,
    }).where(eq(priceBotAdmins.id, id)).returning();
    if (target.active && !row.active) {
      await revokeAllSessions(id);
      await audit(req, "user.suspend", { type: "user", id }, { label: row.label });
    } else if (!target.active && row.active) {
      await audit(req, "user.restore", { type: "user", id }, { label: row.label });
    }
    const changed = Object.keys(data).filter((key) => key !== "active");
    if (changed.length) await audit(req, "user.update", { type: "user", id }, { fields: changed, permissions: row.permissions, sharedWhatsapp: row.whatsappOwnerId !== null });
    res.json(UpdateAdminResponse.parse(adminDto(row)));
  } catch (error) {
    if (isUniqueViolation(error)) { res.status(409).json({ error: "הטלפון או האימייל כבר משויכים למשתמש אחר" }); return; }
    next(error);
  }
});

router.delete("/admins/:id", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const { id } = DeleteAdminParams.parse(req.params);
    const [admin] = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.id, id));
    if (admin?.role === "owner") {
      res.status(403).json({ error: "לא ניתן למחוק את בעל המערכת" });
      return;
    }
    if (id === req.authAdmin!.id) {
      res.status(400).json({ error: "לא ניתן למחוק את עצמך" });
      return;
    }
    await db.delete(priceBotAdmins).where(eq(priceBotAdmins.id, id));
    if (admin) await audit(req, "user.delete", { type: "user", id }, { label: admin.label, phone: admin.phone });
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
    await audit(req, "user.set_pin", { type: "user", id });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/admins/:id/invite", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const { id } = InviteAdminParams.parse(req.params);
    const target = await loadManageable(req, res, id);
    if (!target) return;
    if (!target.active) { res.status(400).json({ error: "המשתמש מושעה. הפעילו אותו לפני שליחת הזמנה." }); return; }
    const link = appLink(req);
    const text = [
      `👋 שלום ${target.label},`,
      "",
      `${req.authAdmin!.label} הזמין/ה אותך לנהל את *מחירון בוואטסאפ*.`,
      "",
      `🔗 כניסה: ${link}`,
      "בכניסה הזינו את מספר הטלפון הזה ובחרו „שליחת קוד ב־WhatsApp”.",
    ].join("\n");
    const sent = await sendViaAnyConnection(target, text);
    if (sent) await db.update(priceBotAdmins).set({ invitedAt: new Date() }).where(eq(priceBotAdmins.id, id));
    await audit(req, sent ? "user.invite" : "user.invite_failed", { type: "user", id }, { link });
    res.json(InviteAdminResponse.parse({ sent, link }));
  } catch (error) {
    next(error);
  }
});

router.post("/admins/:id/sessions/revoke", async (req, res, next) => {
  try {
    const { id } = RevokeAdminSessionsParams.parse(req.params);
    if (id !== req.authAdmin!.id && !canManageUsers(req.authAdmin!)) { res.status(403).json({ error: "אין לך הרשאה לניהול משתמשים" }); return; }
    const target = await loadManageable(req, res, id);
    if (!target) return;
    await revokeAllSessions(id);
    await audit(req, "user.sessions_revoked", { type: "user", id }, { label: target.label });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export async function auditEntries(limit: number, filter?: { actorId?: number; problemsOnly?: boolean }) {
  const conditions = [
    filter?.actorId !== undefined ? eq(priceBotAuditLog.actorId, filter.actorId) : undefined,
    filter?.problemsOnly ? sql`${priceBotAuditLog.action} ~ '\\.(error|failed|disconnected|logged_out|replaced|login_failed)$'` : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition !== undefined);
  const rows = await db.select({ entry: priceBotAuditLog, actorLabel: priceBotAdmins.label })
    .from(priceBotAuditLog)
    .leftJoin(priceBotAdmins, eq(priceBotAdmins.id, priceBotAuditLog.actorId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(priceBotAuditLog.createdAt), desc(priceBotAuditLog.id))
    .limit(limit);
  return rows.map(({ entry, actorLabel }) => ({
    id: entry.id, actorId: entry.actorId, actorLabel: actorLabel ?? null, action: entry.action,
    targetType: entry.targetType, targetId: entry.targetId, details: entry.details ?? {},
    createdAt: entry.createdAt.toISOString(),
  }));
}

router.get("/audit-log", requirePermission("users.manage"), async (req, res, next) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const actorId = req.query.actorId === undefined ? undefined : Number(req.query.actorId);
    res.json(ListAuditLogResponse.parse(await auditEntries(limit, { actorId: Number.isFinite(actorId) ? actorId : undefined })));
  } catch (error) {
    next(error);
  }
});

export default router;
