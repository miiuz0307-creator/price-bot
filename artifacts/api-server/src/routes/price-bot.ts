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

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);
const sessionCookieName = "price_bot_session";
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const primaryOwnerPhone = "0504107826";
const primaryOwnerLabel = "מיכאל";

type AuthAdmin = typeof priceBotAdmins.$inferSelect;
declare global {
  namespace Express {
    interface Request {
      authAdmin?: AuthAdmin;
    }
  }
}

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be configured");
  return secret;
}

function encodeSession(adminId: number) {
  const payload = Buffer.from(JSON.stringify({ adminId, exp: Date.now() + sessionLifetimeMs, nonce: randomBytes(16).toString("hex") })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSession(value: string | undefined) {
  if (!value) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as { adminId?: number; exp?: number };
    return typeof parsed.adminId === "number" && typeof parsed.exp === "number" && parsed.exp > Date.now() ? parsed : null;
  } catch {
    return null;
  }
}

async function hashCode(code: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(code, salt, 64) as Buffer;
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyCode(code: string, stored: string) {
  const [algorithm, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scrypt(code, Buffer.from(saltValue, "base64url"), expected.length) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function validCode(code: string) {
  return /^\d{4,8}$/.test(code);
}

function sendSession(res: import("express").Response, admin: AuthAdmin) {
  res.cookie(sessionCookieName, encodeSession(admin.id), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeMs, path: "/",
  });
}

const requireAdmin: RequestHandler = async (req, res, next) => {
  try {
    const session = readSession(req.cookies?.[sessionCookieName]);
    if (!session) {
      res.status(401).json({ error: "נדרשת התחברות" });
      return;
    }
    const adminId = session.adminId;
    if (typeof adminId !== "number") {
      res.status(401).json({ error: "נדרשת התחברות" });
      return;
    }
    const [admin] = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, adminId), eq(priceBotAdmins.active, true)));
    if (!admin) {
      res.clearCookie(sessionCookieName, { path: "/" });
      res.status(401).json({ error: "הגישה אינה פעילה" });
      return;
    }
    req.authAdmin = admin;
    next();
  } catch (error) {
    next(error);
  }
};

const requireOwner: RequestHandler = (req, res, next) => {
  if (req.authAdmin?.role !== "owner") {
    res.status(403).json({ error: "פעולה זו זמינה לבעלים בלבד" });
    return;
  }
  next();
};

function normalizePhone(value: string) {
  let digits = value.trim().replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits;
}

function normalizeIdentifier(value: string, kind: string) {
  return kind === "group" ? value.trim().replace(/@g\.us$/i, "") : normalizePhone(value);
}

function levenshteinDistance(left: string, right: string) {
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

type ProductSearchResult =
  | { kind: "match"; product: typeof priceBotProducts.$inferSelect; corrected: boolean }
  | { kind: "ambiguous"; suggestions: string[] }
  | { kind: "needs_route" }
  | null;

function findClosestProduct(rows: (typeof priceBotProducts.$inferSelect)[], query: string, allowFuzzy = true): ProductSearchResult {
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

const jerusalemRemoteNeighborhoods = [
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

const jerusalemRemoteNeighborhoodAdditions = [20, 40, 20, 20, 20, 50, 20, 50];

function messageCredit(admin: typeof priceBotAdmins.$inferSelect | undefined) {
  return admin?.label.trim() === "יצחק" ? "פותח על ידי איש סמוי 😉" : "פותח על ידי מיכאל אילוז 😉";
}

function messageHeader(admin: typeof priceBotAdmins.$inferSelect | undefined) {
  return admin?.label.trim() === "יצחק" ? "🤖 המחירון הרשמי של 8000*" : "🤖 *המחירון הרשמי של 8080*";
}

function formatProductResponse(product: typeof priceBotProducts.$inferSelect, header: string, credit: string) {
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

function formatHourlyPricingResponse(header: string, credit: string) {
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

function formatExtrasResponse(header: string, credit: string) {
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

function productDto(row: typeof priceBotProducts.$inferSelect) {
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

function adminDto(row: typeof priceBotAdmins.$inferSelect) {
  return {
    id: row.id,
    phone: row.phone,
    label: row.label,
    role: row.role === "owner" ? "owner" : "admin",
    active: row.active,
    addedAt: row.addedAt.toISOString(),
  };
}

async function getOrCreateOwnerAdmin() {
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
async function assignLegacyRowsToOwner(ownerId: number) {
  if (legacyRowsAssigned) return;
  await Promise.all([
    db.update(priceBotTargets).set({ adminId: ownerId }).where(isNull(priceBotTargets.adminId)),
    db.update(priceBotLookups).set({ adminId: ownerId }).where(isNull(priceBotLookups.adminId)),
  ]);
  legacyRowsAssigned = true;
}

function targetDto(row: typeof priceBotTargets.$inferSelect) {
  return {
    id: row.id,
    kind: row.kind === "group" ? "group" : "contact",
    identifier: row.identifier,
    label: row.label,
    active: row.active,
    addedAt: row.addedAt.toISOString(),
  };
}

function lookupRequestDto(row: typeof priceBotLookups.$inferSelect) {
  return {
    id: row.id,
    query: row.body.replace(/^מ\s*/u, "").trim() || row.body,
    from: row.from,
    createdAt: row.createdAt.toISOString(),
    estimate: row.estimate ?? null,
  };
}

router.get("/auth/admins", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.active, true)).orderBy(priceBotAdmins.addedAt);
    res.json(ListLoginAdminsResponse.parse(rows.map((row) => ({ id: row.id, label: row.label, role: row.role === "owner" ? "owner" : "admin" }))));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/status", async (_req, res, next) => {
  try {
    const owner = await getOrCreateOwnerAdmin();
    res.json(GetAuthStatusResponse.parse({ ownerSetupRequired: Boolean(owner && !owner.codeHash) }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/bootstrap", async (req, res, next) => {
  try {
    const data = BootstrapOwnerCodeBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    const owner = await getOrCreateOwnerAdmin();
    if (!owner || owner.codeHash) {
      res.status(403).json({ error: "הגדרת קוד הבעלים אינה זמינה" });
      return;
    }
    const [updated] = await db.update(priceBotAdmins).set({ codeHash: await hashCode(data.code) }).where(and(eq(priceBotAdmins.id, owner.id), sql`${priceBotAdmins.codeHash} is null`)).returning();
    if (!updated) {
      res.status(403).json({ error: "הגדרת קוד הבעלים אינה זמינה" });
      return;
    }
    sendSession(res, updated);
    res.json(BootstrapOwnerCodeResponse.parse({ admin: adminDto(updated) }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const data = LoginAdminBody.parse(req.body);
    if (!validCode(data.code)) {
      res.status(400).json({ error: "הקוד חייב להכיל 4 עד 8 ספרות" });
      return;
    }
    const [admin] = await db.select().from(priceBotAdmins).where(and(eq(priceBotAdmins.id, data.adminId), eq(priceBotAdmins.active, true)));
    if (!admin || !admin.codeHash || !(await verifyCode(data.code, admin.codeHash))) {
      res.status(401).json({ error: "קוד אישי שגוי או גישה לא פעילה" });
      return;
    }
    sendSession(res, admin);
    res.json(LoginAdminResponse.parse({ admin: adminDto(admin) }));
  } catch (error) {
    next(error);
  }
});

router.get("/auth/session", requireAdmin, (req, res) => {
  res.json(GetCurrentSessionResponse.parse({ admin: adminDto(req.authAdmin!) }));
});

router.post("/auth/logout", requireAdmin, (_req, res) => {
  res.clearCookie(sessionCookieName, { path: "/" });
  res.status(204).end();
});

router.use((req, res, next) => req.path === "/webhooks/whatsapp" ? next() : requireAdmin(req, res, next));

router.get("/products", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotProducts).orderBy(priceBotProducts.name);
    res.json(ListProductsResponse.parse(rows.map(productDto)));
  } catch (error) {
    next(error);
  }
});

router.post("/products", async (req, res, next) => {
  try {
    const data = CreateProductBody.parse(req.body);
    const [row] = await db
      .insert(priceBotProducts)
      .values({
        name: data.name,
        price: String(data.price),
        currency: data.currency ?? "ILS",
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

router.patch("/products/:id", async (req, res, next) => {
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
        currency: data.currency ?? current.currency,
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

router.delete("/products/:id", async (req, res, next) => {
  try {
    const { id } = DeleteProductParams.parse(req.params);
    await db.delete(priceBotProducts).where(eq(priceBotProducts.id, id));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

function parseAbbreviation(input: { shortcut: string; expansion: string }) {
  const shortcut = input.shortcut.trim();
  const expansion = input.expansion.trim().replace(/\s+/gu, " ");
  if (!/^[\p{L}\p{N}]{2,20}$/u.test(shortcut)
    || !/^[\p{L}\p{N}][\p{L}\p{N}\s,.'׳״-]{1,79}$/u.test(expansion)
    || normalizeSearchText(shortcut) === normalizeSearchText(expansion)) return null;
  return { shortcut, expansion, normalizedShortcut: normalizeSearchText(shortcut) };
}

function abbreviationDto(row: typeof priceBotAbbreviations.$inferSelect) {
  return { id: row.id, shortcut: row.shortcut, expansion: row.expansion, updatedAt: row.updatedAt.toISOString() };
}

function isAbbreviationConflict(error: unknown): boolean {
  const value = error as { code?: string; cause?: { code?: string } };
  return value?.code === "23505" || value?.cause?.code === "23505";
}

router.get("/abbreviations", async (_req, res, next) => {
  try {
    const rows = await db.select().from(priceBotAbbreviations).orderBy(priceBotAbbreviations.shortcut);
    res.json(ListAbbreviationsResponse.parse(rows.map(abbreviationDto)));
  } catch (error) { next(error); }
});

router.post("/abbreviations", async (req, res, next) => {
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

router.patch("/abbreviations/:id", async (req, res, next) => {
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

router.delete("/abbreviations/:id", async (req, res, next) => {
  try {
    const { id } = DeleteAbbreviationParams.parse(req.params);
    const [row] = await db.delete(priceBotAbbreviations).where(eq(priceBotAbbreviations.id, id)).returning();
    if (!row) { res.status(404).json({ error: "הקיצור לא נמצא." }); return; }
    res.status(204).end();
  } catch (error) { next(error); }
});

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

router.get("/lookup-requests", async (req, res, next) => {
  try {
    const rows = await db
      .select()
      .from(priceBotLookups)
      .where(and(eq(priceBotLookups.matched, false), eq(priceBotLookups.adminId, req.authAdmin!.id)))
      .orderBy(desc(priceBotLookups.createdAt))
      .limit(20);
    res.json(ListLookupRequestsResponse.parse(rows.map(lookupRequestDto)));
  } catch (error) {
    next(error);
  }
});

router.delete("/lookup-requests/:id", async (req, res, next) => {
  try {
    const { id } = DeleteLookupRequestParams.parse(req.params);
    await db.delete(priceBotLookups).where(and(eq(priceBotLookups.id, id), eq(priceBotLookups.adminId, req.authAdmin!.id)));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/lookup-requests/:id/approve", async (req, res, next) => {
  try {
    const { id } = ApproveLookupEstimateParams.parse(req.params);
    const outcome = await db.transaction(async (tx) => {
      const [request] = await tx
        .select()
        .from(priceBotLookups)
        .where(and(eq(priceBotLookups.id, id), eq(priceBotLookups.adminId, req.authAdmin!.id)))
        .for("update");
      if (!request?.estimate) return { status: 404 as const };
      const { name, distanceKm, priceMatrix, waitTime } = request.estimate;
      if (!name || !Number.isFinite(distanceKm) || distanceKm <= 0
        || priceMatrix.length !== 8 || priceMatrix.some((price) => !Number.isFinite(price) || price <= 0))
        return { status: 422 as const };

      const variants = normalizedSearchVariants(name);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${[...variants].sort().join("|")}))`);
      const existing = await tx.select().from(priceBotProducts);
      if (existing.some((product) => [product.name, ...product.aliases].some((candidate) =>
        normalizedSearchVariants(candidate).some((variant) => variants.includes(variant)),
      ))) return { status: 409 as const };

      const [product] = await tx.insert(priceBotProducts).values({
        name,
        price: String(priceMatrix[0]),
        currency: "ILS",
        aliases: [request.body.replace(/^מ\s*/u, "").trim()].filter((alias) => alias && alias !== name),
        distance: `${distanceKm.toLocaleString("he-IL", { maximumFractionDigits: 1 })} ק״מ`,
        level: "אושר על ידי מנהל",
        priceMatrix,
        waitTime: waitTime ?? "",
        active: true,
      }).returning();
      await tx.delete(priceBotLookups).where(eq(priceBotLookups.id, id));
      return { status: 201 as const, product };
    });
    if (outcome.status !== 201) {
      res.status(outcome.status).json({ error: outcome.status === 409
        ? "המסלול כבר קיים במחירון. לא שיניתי מחירים קיימים."
        : outcome.status === 422 ? "ההערכה אינה תקינה ואי אפשר לאשר אותה." : "לא נמצאה הערכה ממתינה לאישור." });
      return;
    }
    res.status(201).json(ApproveLookupEstimateResponse.parse(productDto(outcome.product)));
  } catch (error) {
    next(error);
  }
});

router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const [products, admins, lookups, recent] = await Promise.all([
      db.select({ total: sql<number>`count(*)::int`, active: sql<number>`count(*) filter (where ${priceBotProducts.active})::int` }).from(priceBotProducts),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotAdmins).where(eq(priceBotAdmins.active, true)),
      db.select({ total: sql<number>`count(*)::int` }).from(priceBotLookups).where(eq(priceBotLookups.adminId, req.authAdmin!.id)),
      db.select({ createdAt: priceBotLookups.createdAt }).from(priceBotLookups).where(eq(priceBotLookups.adminId, req.authAdmin!.id)).orderBy(desc(priceBotLookups.createdAt)).limit(1),
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
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.getStatus(req.authAdmin!.id, req.authAdmin!.role === "owner")));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/connect", async (req, res, next) => {
  try {
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.connectFresh(req.authAdmin!.id)));
  } catch (error) {
    next(error);
  }
});

router.post("/integration/whatsapp/disconnect", async (req, res, next) => {
  try {
    res.json(GetWhatsAppStatusResponse.parse(await whatsappWeb.disconnect(req.authAdmin!.id)));
  } catch (error) {
    next(error);
  }
});

router.get("/integration/whatsapp/groups", async (req, res, next) => {
  try {
    const [groups, savedGroups] = await Promise.all([
      whatsappWeb.listGroups(req.authAdmin!.id),
      db.select().from(priceBotTargets).where(and(eq(priceBotTargets.kind, "group"), eq(priceBotTargets.adminId, req.authAdmin!.id))),
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

async function surgeStatus(adminId: number) {
  const now = new Date();
  const [settings, offers, products, groups, connection] = await Promise.all([
    db.select().from(priceBotSurgeSettings).where(eq(priceBotSurgeSettings.adminId, adminId)).then((rows) => rows[0]),
    db.select().from(priceBotSurgeOffers).where(and(eq(priceBotSurgeOffers.adminId, adminId), gt(priceBotSurgeOffers.expiresAt, now))).orderBy(desc(priceBotSurgeOffers.observedAt)),
    db.select({
      id: priceBotProducts.id, name: priceBotProducts.name, active: priceBotProducts.active,
      price: priceBotProducts.price, priceMatrix: priceBotProducts.priceMatrix,
    }).from(priceBotProducts),
    whatsappWeb.listGroups(adminId),
    whatsappWeb.getStatus(adminId),
  ]);
  const productById = new Map(products.filter((row) => row.active).map((row) => [row.id, row]));
  const groupById = new Map(groups.map((group) => [group.identifier, group.label]));
  return GetSurgeStatusResponse.parse({
    active: settings?.active ?? false,
    connected: connection.connected,
    groupIdentifiers: settings?.groupIdentifiers ?? [],
    offers: settings?.active ? offers.filter((row) =>
      row.observedAt >= settings.startedAt && productById.has(row.productId)
      && !!row.directionKey && isSurgeActiveAt(row, now) && isSurgeAboveCatalog(row, productById.get(row.productId)!)).map((row) => ({
      id: row.id, productId: row.productId, route: row.quotedRoute,
      price: row.price, vehicleType: row.vehicleType, extraPassenger: row.extraPassenger,
      groupIdentifier: row.groupIdentifier, groupLabel: groupById.get(row.groupIdentifier) ?? row.groupIdentifier,
      observedAt: row.observedAt.toISOString(), expiresAt: surgeEffectiveExpiry(row).toISOString(),
    })) : [],
  });
}

router.get("/surge", async (req, res, next) => {
  try { res.json(await surgeStatus(req.authAdmin!.id)); } catch (error) { next(error); }
});

router.post("/surge/start", async (req, res, next) => {
  try {
    const input = StartSurgeMonitoringBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "בחרו לפחות קבוצת WhatsApp אחת." }); return; }
    const identifiers = [...new Set(input.data.groupIdentifiers)];
    const connection = await whatsappWeb.getStatus(req.authAdmin!.id);
    if (!connection.connected) { res.status(409).json({ error: "חברו את WhatsApp לפני הפעלת זמני עומס." }); return; }
    const groups = await whatsappWeb.listGroups(req.authAdmin!.id);
    const available = new Set(groups.map((group) => group.identifier));
    if (!identifiers.length || identifiers.some((identifier) => !available.has(identifier))) {
      res.status(400).json({ error: "יש לבחור קבוצות שהבוט מחובר אליהן." }); return;
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(priceBotSurgeSettings)
        .values({ adminId: req.authAdmin!.id, active: true, groupIdentifiers: identifiers, startedAt: now })
        .onConflictDoUpdate({ target: priceBotSurgeSettings.adminId, set: { active: true, groupIdentifiers: identifiers, startedAt: now } });
      await tx.update(priceBotSurgeOffers).set({ expiresAt: now }).where(eq(priceBotSurgeOffers.adminId, req.authAdmin!.id));
    });
    res.json(StartSurgeMonitoringResponse.parse(await surgeStatus(req.authAdmin!.id)));
  } catch (error) { next(error); }
});

router.post("/surge/stop", async (req, res, next) => {
  try {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(priceBotSurgeSettings).set({ active: false }).where(eq(priceBotSurgeSettings.adminId, req.authAdmin!.id));
      await tx.update(priceBotSurgeOffers).set({ expiresAt: now }).where(eq(priceBotSurgeOffers.adminId, req.authAdmin!.id));
    });
    res.json(StopSurgeMonitoringResponse.parse(await surgeStatus(req.authAdmin!.id)));
  } catch (error) { next(error); }
});

async function captureSurgeQuote({ adminId, chatId, body, isGroup, sentAt }: IncomingWhatsAppMessage) {
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
  const knownPlaces = [
    ...products.flatMap((product) => [product.name, ...product.aliases].flatMap((name) => name.split("⇔").map((place) => place.trim()))),
    ...abbreviations.map((row) => row.shortcut),
  ];
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

async function currentSurgeOffers(
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
    const admins = await db.select({ phone: priceBotAdmins.phone }).from(priceBotAdmins).where(eq(priceBotAdmins.active, true));
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
        const surges = !result.corrected ? await currentSurgeOffers(adminId, result.product, route, abbreviations) : [];
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
    void db.select({ phone: priceBotAdmins.phone }).from(priceBotAdmins).where(eq(priceBotAdmins.active, true))
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

whatsappWeb.registerMessageHandler(async (message) => {
  if (message.isGroup) await captureSurgeQuote(message);
  if (message.isHistory) return null;
  const result = await processPriceBotMessage(message);
  return result.shouldReply ? result : null;
});

void (async () => {
  const owner = await getOrCreateOwnerAdmin();
  const admins = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.active, true));
  await Promise.all(admins.map((admin) => whatsappWeb.getStatus(admin.id, admin.id === owner.id)));
})().catch((error) => logger.error({ err: error }, "Unable to initialize administrator WhatsApp sessions"));

router.post("/webhooks/whatsapp", async (req, res, next) => {
  try {
    const { from, body } = ReceiveWhatsAppMessageBody.parse(req.body);
    // The synthetic local-test webhook is deliberately pinned to the legacy owner;
    // it can never select another administrator without an authenticated cookie.
    const owner = await getOrCreateOwnerAdmin();
    const result = await processPriceBotMessage({ adminId: owner.id, from, chatId: from, body, notifyAdmins: false });
    res.json(ReceiveWhatsAppMessageResponse.parse(result));
  } catch (error) {
    next(error);
  }
});

export default router;