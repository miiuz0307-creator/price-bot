import { Router, type IRouter, type RequestHandler } from "express";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  or,
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
  migrationsReady,
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
import { normalizeCurrency, productDto, adminDto, targetDto, lookupRequestDto } from "../routes/dto";
import { audit } from "../services/audit";
import { primaryOwnerPhone, primaryOwnerLabel, ownerBootstrapAllowed, getOrCreateOwnerAdmin } from "../services/owner";

/**
 * Single place names the bot knows: both endpoints of every catalog route
 * ("בני ברק ⇔ ירושלים" → "בני ברק", "ירושלים"), single-place aliases and
 * custom shortcuts. Aliases that spell a whole route ("בב ים") are left out:
 * read as one place they hid the second endpoint, so a group quote "בב ים 260"
 * was ignored and "מ בני ברק ירושלים" never showed a live surge price.
 */
export function catalogPlaceNames(
  products: readonly { name: string; aliases: string[] }[],
  abbreviations: readonly { shortcut: string }[],
) {
  return [
    ...products.flatMap((product) => {
      const routeVariants = new Set(normalizedSearchVariants(product.name));
      const placeAliases = product.aliases.filter((alias) =>
        !normalizedSearchVariants(alias).some((variant) => routeVariants.has(variant)));
      return [product.name, ...placeAliases].flatMap((name) => name.split("⇔").map((place) => place.trim()).filter(Boolean));
    }),
    ...abbreviations.map((row) => row.shortcut),
  ];
}

/**
 * Active users who work in this WhatsApp workspace: its owner plus anyone it is
 * shared with. Management commands and missing-price alerts stay inside it
 * (before, every manager in the system received every workspace's alerts).
 */
async function workspaceMembers(adminId: number) {
  return db.select({ phone: priceBotAdmins.phone }).from(priceBotAdmins)
    .where(and(eq(priceBotAdmins.active, true), or(eq(priceBotAdmins.id, adminId), eq(priceBotAdmins.whatsappOwnerId, adminId))));
}

export async function captureSurgeQuote({ adminId, chatId, body, isGroup, sentAt }: IncomingWhatsAppMessage) {
  // The quote parser only accepts two-to-four-digit prices. Avoid a database
  // lookup for ordinary group chatter and price requests without an amount.
  if (!isGroup || !Number.isFinite(sentAt) || !/[1-9]\d{1,3}/u.test(body)) return;
  const [settings] = await db.select().from(priceBotSurgeSettings).where(eq(priceBotSurgeSettings.adminId, adminId));
  const timestamp = sentAt!;
  if (!settings?.active || !settings.groupIdentifiers.includes(chatId) || timestamp < settings.startedAt.getTime()
    || timestamp < Date.now() - 5 * 60_000 || timestamp > Date.now() + 2 * 60_000) return;
  const [products, abbreviations] = await Promise.all([
    db.select().from(priceBotProducts).where(eq(priceBotProducts.active, true)),
    db.select({ shortcut: priceBotAbbreviations.shortcut, expansion: priceBotAbbreviations.expansion }).from(priceBotAbbreviations),
  ]);
  const knownPlaces = catalogPlaceNames(products, abbreviations);
  const matchedQuotes = parseSurgeQuotes(body, knownPlaces).flatMap((quote) => {
    const product = matchSurgeProduct(quote, products, abbreviations);
    const directionKey = surgeDirectionKey(quote, abbreviations);
    return product?.currency === "ILS" && directionKey ? [{ quote, product, directionKey }] : [];
  });
  if (!matchedQuotes.length) return;
  const observedAt = new Date(timestamp);
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(priceBotSurgeSettings)
      .where(eq(priceBotSurgeSettings.adminId, adminId)).for("update");
    if (!locked?.active || !locked.groupIdentifiers.includes(chatId) || timestamp < locked.startedAt.getTime()) return;
    for (const { quote, product, directionKey } of matchedQuotes) {
      // A newer regular-price quote supersedes a surge too; its expired row also
      // prevents delayed older surge messages from reactivating that price.
      const expiresAt = isSurgeAboveCatalog(quote, product)
        ? new Date(timestamp + surgeLifetimeMs) : new Date();
      await tx.insert(priceBotSurgeOffers).values({
        adminId, productId: product.id, price: quote.price,
        vehicleType: quote.vehicleType, extraPassenger: quote.extraPassenger, groupIdentifier: chatId,
        directionKey, quotedRoute: `${quote.origin} → ${quote.destination}`,
        observedAt, expiresAt,
      }).onConflictDoUpdate({
        target: [priceBotSurgeOffers.adminId, priceBotSurgeOffers.productId, priceBotSurgeOffers.vehicleType, priceBotSurgeOffers.extraPassenger, priceBotSurgeOffers.directionKey],
        set: { price: quote.price, quotedRoute: `${quote.origin} → ${quote.destination}`, groupIdentifier: chatId, observedAt, expiresAt },
        setWhere: sql`${priceBotSurgeOffers.observedAt} < ${observedAt}`,
      });
    }
  });
}

export async function currentSurgeOffers(
  adminId: number,
  product: typeof priceBotProducts.$inferSelect,
  route: { origin: string; destination: string } | null,
  abbreviations: readonly { shortcut: string; expansion: string }[],
) {
  if (!route) return [];
  const now = new Date();
  // Read settings and offers in one fresh database snapshot; never cache a
  // manager's active state or prices, and avoid a second round trip per reply.
  const rows = await db.select({ offer: priceBotSurgeOffers }).from(priceBotSurgeOffers)
    .innerJoin(priceBotSurgeSettings, eq(priceBotSurgeSettings.adminId, priceBotSurgeOffers.adminId)).where(and(
    eq(priceBotSurgeSettings.active, true),
    eq(priceBotSurgeOffers.adminId, adminId), eq(priceBotSurgeOffers.productId, product.id),
    gt(priceBotSurgeOffers.expiresAt, now), gt(priceBotSurgeOffers.observedAt, priceBotSurgeSettings.startedAt),
  ));
  return rows.map((row) => row.offer).filter((offer) => matchesSurgeDirection(offer, route, abbreviations)
    && isSurgeActiveAt(offer, now) && isSurgeAboveCatalog(offer, product))
    .map((offer) => ({ ...offer, expiresAt: surgeEffectiveExpiry(offer) }));
}

export async function processPriceBotMessage({
  adminId,
  from,
  chatId = from,
  body,
  isGroup = false,
  notifyAdmins = true,
}: Pick<IncomingWhatsAppMessage, "adminId" | "from" | "chatId" | "body"> & Partial<Pick<IncomingWhatsAppMessage, "isGroup">> & { notifyAdmins?: boolean }) {
  const message = body.trim();
  const groupPriceQuery = /^מ\s+.+/u.test(message);
  if (isGroup && !groupPriceQuery) {
    return { matched: false, responseText: "", shouldReply: false };
  }
  const [targets, admin] = await Promise.all([
    db.select().from(priceBotTargets).where(and(eq(priceBotTargets.active, true), eq(priceBotTargets.adminId, adminId))),
    db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, adminId), eq(priceBotAdmins.active, true))).then((rows) => rows[0]),
  ]);
  const target = targets.find((row) => normalizeIdentifier(row.identifier, row.kind) === normalizeIdentifier(chatId, isGroup ? "group" : "contact"));
  let responseText = "";
  let matched = false;
  let localRouteWithoutPrice = false;
  let estimate: { name: string; distanceKm: number; priceMatrix: number[]; waitTime?: string } | null = null;
  const header = messageHeader(admin);
  const credit = messageCredit(admin);
  const billingAmount = parseBillingAmount(message);
  if (!target) {
    responseText = "הבוט אינו פעיל בשיחה זו.";
  } else if (message === "ניהול") {
    const admins = await workspaceMembers(adminId);
    const senderIsAdmin = admins.some((row) => normalizePhone(row.phone) === normalizePhone(from));
    responseText = senderIsAdmin ? "הגישה לממשק הניהול מאושרת. פתח/י את קישור הניהול המאובטח שלך." : "אין הרשאת ניהול למספר זה.";
    matched = senderIsAdmin;
  } else if (billingAmount !== null) {
    matched = true;
    responseText = formatBillingCalculation(billingAmount);
  } else if (/^מ\s+לפי\s+שעה$/u.test(message)) {
    matched = true;
    responseText = formatHourlyPricingResponse(header, credit);
  } else if (/^מ\s+תוספות$/u.test(message)) {
    matched = true;
    responseText = formatExtrasResponse(header, credit);
  } else if (message.startsWith("מ")) {
    const query = message.slice(1).trim();
    if (!query) {
      responseText = "לבדיקת מחיר שלח/י: מ [שם המוצר או המסלול]";
    } else {
      const [allProducts, abbreviations] = await Promise.all([
        db.select().from(priceBotProducts),
        db.select({
          shortcut: priceBotAbbreviations.shortcut,
          expansion: priceBotAbbreviations.expansion,
        }).from(priceBotAbbreviations),
      ]);
      const products = allProducts.filter((product) => product.active);
      const knownPlaces = [...allProducts.flatMap((product) => product.aliases), ...abbreviations.map((row) => row.shortcut)];
      const rawRoute = parseUnlistedRoute(query, knownPlaces);
      const expand = (value: string) => expandCustomAbbreviations(value, abbreviations);
      const expandedQuery = expand(query);
      const route = rawRoute ? { origin: expand(rawRoute.origin), destination: expand(rawRoute.destination) } : null;
      const singleShortcut = abbreviations.some((row) =>
        normalizeSearchText(row.shortcut) === normalizeSearchText(query));
      const result = singleShortcut ? { kind: "needs_route" as const }
        : findClosestProduct(products, expandedQuery, !route);
      if (result?.kind === "match") {
        matched = true;
        // Surge direction uses the full place list (route endpoints too), so a lookup
        // typed with multi-word city names finds live surge prices. Matching and
        // spelling correction above are unchanged.
        const surgeRawRoute = rawRoute ?? parseUnlistedRoute(query, catalogPlaceNames(allProducts, abbreviations));
        const surgeRoute = surgeRawRoute ? { origin: expand(surgeRawRoute.origin), destination: expand(surgeRawRoute.destination) } : null;
        const surges = !result.corrected ? await currentSurgeOffers(adminId, result.product, surgeRoute, abbreviations) : [];
        const surgeText = sortSurgeOffers(surges).map((offer) => {
          const clock = (date: Date) => date.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
          const vehicle = {
            regular: "רכב רגיל · 4 מקומות",
            small_minivan: "מיניק · 6 מקומות קטן",
            roomy_six: "6 מקומות מרווח",
            sienna: "סייאנה / סיינה · 7 מקומות",
          }[offer.vehicleType] ?? "סוג רכב לא מזוהה";
          return `🔥 *מחיר מעודכן בזמן אמת · ${vehicle}: ${formatSurgePrice(offer)}*\nכיוון העומס: ${offer.quotedRoute}.\nמחיר עומס זמני מקבוצה · נקלט ב־${clock(offer.observedAt)} · בתוקף עד ${clock(offer.expiresAt)}.`;
        }).join("\n\n");
        responseText = `${result.corrected ? `אולי התכוונת ל־${result.product.name}?\n` : ""}${surgeText
          ? `${surgeText}\nהמחירון הקבוע מופיע להלן:\n\n` : ""}${formatProductResponse(result.product, header, credit)}`;
      } else if (result?.kind === "needs_route") {
        responseText = "כדי לקבל מחיר מדויק כתבו מוצא ויעד מלאים, למשל: מ אופקים באר שבע.";
      } else if (result?.kind === "ambiguous") {
        responseText = `מצאתי כמה מסלולים אפשריים:\n${result.suggestions.map((name) => `• ${name}`).join("\n")}\n\nכתבו את המוצא והיעד המלאים כדי שאציג מחיר מדויק.`;
      } else {
        const queryVariants = normalizedSearchVariants(expandedQuery);
        const alreadySaved = allProducts.some((product) => [product.name, ...product.aliases].some((candidate) =>
          normalizedSearchVariants(candidate).some((variant) => queryVariants.includes(variant)),
        ));
        if (alreadySaved) {
          responseText = `המסלול "${query}" כבר שמור במחירון, אך אינו זמין כרגע. הבקשה נשמרה במערכת הניהול לבדיקה.`;
        } else {
          if (!route) {
            responseText = `לא מצאתי מחיר עבור "${query}". להערכת מחיר ציינו מוצא ויעד עם ⇔ ביניהם, למשל: מ פתח תקווה ⇔ תל אביב. הבקשה נשמרה במערכת הניהול.`;
          } else if (requiresManualCatalogPrice(route.origin, route.destination)) {
            responseText = `המסלול "${query}" ממתין להשלמת המחיר במחירון. לא אחשב לו מחיר לפי ק״מ; הבקשה נשמרה למנהלים לבדיקה.`;
          } else if (isIntraCityRoute(route.origin, route.destination, knownPlaces)) {
            localRouteWithoutPrice = true;
            responseText = `אין כרגע מחיר במחירון עבור "${query}". אין שירות לחישוב מחיר לפי ק״מ בתוך העיר. למחיר של מסלול פנימי מדויק, כתבו מוצא ויעד; הבקשה נשמרה למנהלים לבדיקה.`;
          } else if (!resolveRouteAddresses(route.origin, route.destination)) {
            responseText = `לא מצאתי מחיר עבור "${query}". שם אחד המקומות אינו חד־משמעי; כתבו אותו במלואו (למשל: קרית גת במקום גת, או רמות ירושלים במקום רמות). הבקשה נשמרה למנהלים לבדיקה.`;
          } else {
            try {
              const reference = estimateReferenceRoute(route.origin, route.destination);
              const distance = await drivingDistanceKm(reference.origin, reference.destination);
              const matrix = distance?.kind === "intercity" ? estimatedPriceMatrix(distance.distanceKm, products) : null;
              if (distance?.kind === "intercity" && matrix) {
                const waitTime = estimatedWaitTime(matrix[0], products);
                estimate = { name: `${route.origin} ⇔ ${route.destination}`, distanceKm: distance.distanceKm, priceMatrix: matrix, ...(waitTime ? { waitTime } : {}) };
                responseText = formatRouteEstimate(route.origin, route.destination, distance.distanceKm, matrix, waitTime);
              } else if (distance?.kind === "not_intercity") {
                responseText = `אין כרגע מחיר במחירון עבור "${query}". לא ניתן להעריך מחיר לפי ק״מ למסלול הזה. כתבו מוצא ויעד מדויקים לקבלת מחיר מהמחירון; הבקשה נשמרה למנהלים לבדיקה.`;
              } else {
                responseText = `לא מצאתי מחיר עבור "${query}" ולא הצלחתי לבדוק מרחק נסיעה כעת. הבקשה נשמרה במערכת הניהול להוספת מחיר.`;
              }
            } catch (error) {
              logger.warn({ err: error }, "Unable to calculate unlisted route estimate");
              responseText = `לא מצאתי מחיר עבור "${query}" ולא הצלחתי לבדוק מרחק נסיעה כעת. הבקשה נשמרה במערכת הניהול להוספת מחיר.`;
            }
          }
        }
      }
    }
  } else responseText = "לבדיקת מחיר שלח/י: מ [מסלול]";
  await db.insert(priceBotLookups).values({ adminId, from, body, matched, estimate });
  if (target && notifyAdmins && !matched && !estimate && groupPriceQuery) {
    const notification = `📍 *בקשת מחיר ללא מחיר במחירון*\nמסלול: ${body.trim()}\nמאת: ${from}\n${localRouteWithoutPrice ? "נסיעה בתוך העיר — לא נשלחה הערכת מפות." : "לא נשלחה הערכת מחיר."}\nהבקשה ממתינה באתר הניהול.`;
    void workspaceMembers(adminId)
      .then((admins) => Promise.all(admins.map((manager) =>
        whatsappWeb.sendMessageToPhone(adminId, manager.phone, notification),
      ))).then((delivered) => {
      if (delivered.some((success) => !success)) {
        logger.warn({ adminId }, "Some price request notifications could not be delivered; request remains in dashboard");
      }
    }).catch((error) => logger.warn({ err: error, adminId }, "Unable to notify managers of price request"));
  }
  return { matched, responseText, shouldReply: Boolean(target) };
}

// Connection problems and changes go to the activity log; the owner sees them as alerts.
whatsappWeb.onEvent((event) => {
  const action = {
    connected: "whatsapp.connected", disconnected: "whatsapp.disconnected", logged_out: "whatsapp.logged_out",
    replaced: "whatsapp.replaced", code_expired: "whatsapp.code_expired", error: "whatsapp.error",
  }[event.type];
  void audit(null, action, { type: "workspace", id: event.adminId }, {
    ...(event.detail ? { detail: event.detail } : {}), ...(event.phoneNumber ? { phoneNumber: event.phoneNumber } : {}),
  }, null);
});

whatsappWeb.registerMessageHandler(async (message) => {
  if (message.isGroup) await captureSurgeQuote(message);
  if (message.isHistory) return null;
  const result = await processPriceBotMessage(message);
  return result.shouldReply ? result : null;
});

export const priceBotReady: Promise<void> = (async () => {
  await migrationsReady;
  // One-time, idempotent repair of products saved with "₪" by the old web forms.
  await db.update(priceBotProducts).set({ currency: "ILS" })
    .where(sql`trim(${priceBotProducts.currency}) in ('₪', 'ils', 'nis', 'NIS', 'ש"ח', 'ש״ח', 'שח', 'שקל')`);
  const owner = await getOrCreateOwnerAdmin();
  const initialCode = process.env.OWNER_INITIAL_CODE?.trim();
  if (!owner.codeHash && initialCode) {
    if (validCode(initialCode)) {
      await db.update(priceBotAdmins).set({ codeHash: await hashCode(initialCode) })
        .where(and(eq(priceBotAdmins.id, owner.id), sql`${priceBotAdmins.codeHash} is null`));
      logger.info("Owner code set from OWNER_INITIAL_CODE; remove the variable now");
    } else {
      logger.warn("OWNER_INITIAL_CODE must be 4-8 digits; ignored");
    }
  }
  // Forgotten owner code: set OWNER_RESET_CODE in the hosting variables, restart,
  // sign in, then remove the variable. Overwrites the owner's personal code.
  const resetCode = process.env.OWNER_RESET_CODE?.trim();
  if (resetCode) {
    if (validCode(resetCode)) {
      await db.update(priceBotAdmins).set({ codeHash: await hashCode(resetCode), active: true }).where(eq(priceBotAdmins.id, owner.id));
      void audit(null, "auth.owner_code_reset", { type: "user", id: owner.id }, { via: "OWNER_RESET_CODE" }, null);
      logger.warn("Owner code reset from OWNER_RESET_CODE; remove the variable now");
    } else {
      logger.warn("OWNER_RESET_CODE must be 4-8 digits; ignored");
    }
  }
  const admins = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.active, true), isNull(priceBotAdmins.whatsappOwnerId)));
  await Promise.all(admins.map((admin) => whatsappWeb.getStatus(admin.id, admin.id === owner.id)));
})().catch((error) => logger.error({ err: error }, "Unable to initialize administrator WhatsApp sessions"));
