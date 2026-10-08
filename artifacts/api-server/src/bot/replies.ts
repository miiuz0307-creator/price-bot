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


export const jerusalemRemoteNeighborhoods = [
  "קרית יובל",
  "קטמון",
  "גילה",
  "נווה יעקב",
  "פסגת זאב",
  "עין כרם",
  "כותל המערבי",
  "ממילא",
  "תלפיות",
  "קבר רחל",
  "הר הזיתים",
  "ארמון הנציב",
  "הר חומה",
  "ארנונה",
];

export const jerusalemRemoteNeighborhoodAdditions = [20, 40, 20, 20, 20, 50, 20, 50];

export function messageCredit(admin: typeof priceBotAdmins.$inferSelect | undefined) {
  return admin?.label.trim() === "יצחק" ? "פותח על ידי איש סמוי 😉" : "פותח על ידי מיכאל אילוז 😉";
}

export function messageHeader(admin: typeof priceBotAdmins.$inferSelect | undefined) {
  return admin?.label.trim() === "יצחק" ? "🤖 המחירון הרשמי של 8000*" : "🤖 *המחירון הרשמי של 8080*";
}

export function formatProductResponse(product: typeof priceBotProducts.$inferSelect, header: string, credit: string) {
  const currency = product.currency === "ILS" ? "₪" : `${product.currency} `;
  const formatPrice = (price: number) => `${currency}${price.toLocaleString("he-IL")}`;
  const pricingLines = (matrix: number[]) => {
    const [fourSeats, fourSeatsSides, sixSeatsSmall, sixSeatsSmallSides, sixSeatsRoomy, sixSeatsRoomySides, sevenSeats, sevenSeatsSides] = matrix;
    const price = (value: number | undefined) => formatPrice(value ?? Number(product.price));
    return [
      `🚗 *4 מק' -* ${price(fourSeats)}`,
      `♾️ *צדדים -* ${price(fourSeatsSides)}`,
      "",
      `🚙 *6 מק' קטן -* ${price(sixSeatsSmall)}`,
      `♾️ *צדדים -* ${price(sixSeatsSmallSides)}`,
      "",
      `🚐 *6 מק' מרווח -* ${price(sixSeatsRoomy)}`,
      `♾️ *צדדים -* ${price(sixSeatsRoomySides)}`,
      "",
      `🚌 *7 מק' (סיינה)-* ${price(sevenSeats)}`,
      `♾️ *צדדים -* ${price(sevenSeatsSides)}`,
    ];
  };
  const isDirectJerusalemTrip = product.name.split("⇔").length === 2 && product.name.includes("ירושלים");
  const hasStandardPriceMatrix = product.priceMatrix.length === 8 && product.priceMatrix.every((price) => price > 0);
  const showJerusalemRemoteNeighborhoods = isDirectJerusalemTrip
    && Number(product.price) <= 300
    && product.level !== "אושר על ידי מנהל"
    && hasStandardPriceMatrix;
  const remoteNeighborhoodMatrix = product.priceMatrix.map(
    (price, index) => price + jerusalemRemoteNeighborhoodAdditions[index],
  );

  return [
    header,
    "",
    `🗺️ *${product.name}*`,
    "",
    product.distance && `🛤️ *מרחק משוער -* ${product.distance}`,
    product.duration && `⌚️ *זמן משוער -* ${product.duration}`,
    product.level && `🧾 *סוג מחירון -* ${product.level}`,
    "",
    ...pricingLines(product.priceMatrix),
    "",
    product.waitTime && `⏳ *המתנה בצדדים -* ${product.waitTime}`,
    ...(showJerusalemRemoteNeighborhoods
      ? [
        "",
        "--------------------------------",
        "",
        "🗺️ *תוספת שכונות - ירושלים*",
        `*${jerusalemRemoteNeighborhoods.join(" / ")}*`,
        "",
        ...pricingLines(remoteNeighborhoodMatrix),
        "",
        `⏳ *המתנה בצדדים -* ${product.waitTime}`,
      ]
      : []),
    "",
    credit,
  ].filter((line): line is string => typeof line === "string").join("\n");
}

export function formatHourlyPricingResponse(header: string, credit: string) {
  return [
    header,
    "",
    "🗺️ *המתנה לפי שעות*",
    "",
    "🚗 *4 מק' -* ₪100",
    "",
    "🚙 *6 מק' קטן -* ₪120",
    "",
    "🚐 *6 מק' מרווח -* ₪130",
    "",
    "----------------------------",
    "",
    "🗺️ *הצמדה לפי שעות - פנימי בתוך העיר*",
    "*מינימום שעה*",
    "",
    "🚗 *4 מק' -* ₪120",
    "",
    "🚙 *6 מק' קטן -* ₪140",
    "",
    "🚐 *6 מק' מרווח -* ₪160",
    "",
    "----------------------------",
    "",
    "🗺️ *הצמדה לפי שעות - בין עירוני*",
    "*כל יציאה מהעיר כולל ב\"ב לפ\"ת וכדו'*",
    "",
    "🚗 *4 מק' -* ₪140",
    "",
    "🚙 *6 מק' קטן -* ₪160",
    "",
    "🚐 *6 מק' מרווח -* ₪180",
    "",
    "•••••••••••••••••••••••••••••••••••••••••",
    "",
    "*חלוקה בהצמדה - בין עירוני*",
    "",
    "*החלוקה תתבצע לפי נקודת היעד הרחוקה ביותר מנקודת ההתחלה*",
    "(לדוגמה: ב\"ב ת\"א חולון ייחשב כאופציה 2, כיוון שב\"ב–חולון ₪100)",
    "(לדוגמה: ב\"ב חולון קרית ספר ייחשב כאופציה 3, כיוון שב\"ב–קרית ספר ₪150)",
    "",
    "*1. נסיעות עד ₪98 -* מינימום שעה",
    "*2. נסיעות מ־₪99 עד ₪148 -* מינימום שעתיים",
    "*3. נסיעות מ־₪149 עד ₪398 -* מינימום 5 שעות",
    "*4. נסיעות מ־₪399 -* מינימום 10 שעות",
    "",
    "*שימו לב!* ⚠️",
    "אם מחיר ההצמדה נמוך ממחיר הלו\"ש הרגיל, הלקוח ישלם את מחיר הלו\"ש.",
    "(לדוגמה: ירושלים–טלז סטון לפי שעה יכול לצאת ₪140; במקרה כזה הלקוח ישלם את מחיר הלו\"ש, ₪160)",
    "",
    credit,
  ].join("\n");
}

export function formatExtrasResponse(header: string, credit: string) {
  return [
    header,
    "",
    "*רשימת תוספות בנסיעות* 📊",
    "",
    "> *☜ בחירת רכב:* 🚕",
    "🚗 *4 מק'*",
    "• עד תינוק אחד מעל.",
    "",
    "🚙 *6 מק' - מיני*",
    "• עד 4 מבוגרים, מעל חובה מרווח.",
    "",
    "----------------------------",
    "",
    "> *☜ תחנות במהלך נסיעה* 🚏",
    "• תחנה לרכב 4 מק' מינימום 10 ש\"ח",
    "• תחנה למיני / מיניוואן מינימום 20 ש\"ח",
    "",
    "----------------------------",
    "",
    "> *☜ תינוק מעל המותר* 👶",
    "• נסיעה צד אחד - תוספת 20 ש\"ח",
    "• נסיעה הלוך ושוב - תוספת 40 ש\"ח",
    "",
    "• תינוק / אחד מעל עד גיל 4.",
    "",
    "----------------------------",
    "",
    "> *☜ רכב סטיישן* 🛻",
    "• נסיעה צד אחד - תוספת 20 ש\"ח",
    "• נסיעה הלוך ושוב - תוספת 40 ש\"ח",
    "• עדיפות סטיישן זה סטיישן!",
    "",
    "----------------------------",
    "",
    "> *☜ כביש 6* 🗾",
    "• תוספת לפי המחירון של כביש 6.",
    "(המחיר שמופיע בווייז)",
    "",
    "----------------------------",
    "",
    "> *☜ קבלה / חשבונית* 🧾",
    "• קבלה (עוסק פטור) - תוספת 10%",
    "• חשבונית מס - תוספת 18%",
    "",
    credit,
  ].join("\n");
}
