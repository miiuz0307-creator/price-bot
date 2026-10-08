import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, priceBotAdmins, priceBotLoginCodes } from "@workspace/db";
import { hashCode, verifyCode, workspaceId, type AuthAdmin } from "../auth/admin-auth";
import { normalizePhone } from "../lib/identifiers";
import { logger } from "../lib/logger";
import { getOrCreateOwnerAdmin } from "./owner";
import { whatsappWeb } from "./whatsapp-web";

const codeLifetimeMs = 5 * 60_000;
const maxCodesPerWindow = 3;
const codeWindowMs = 15 * 60_000;
const maxAttemptsPerCode = 5;

/** Finds an active user by phone (any Israeli format) or e-mail. */
export async function findUserByIdentifier(identifier: string): Promise<AuthAdmin | null> {
  const value = identifier.trim();
  if (!value) return null;
  if (value.includes("@")) {
    const [row] = await db.select().from(priceBotAdmins)
      .where(and(sql`lower(${priceBotAdmins.email}) = ${value.toLowerCase()}`, eq(priceBotAdmins.active, true)));
    return row ?? null;
  }
  const phone = normalizePhone(value);
  if (phone.length < 9) return null;
  const rows = await db.select().from(priceBotAdmins).where(eq(priceBotAdmins.active, true));
  return rows.find((row) => normalizePhone(row.phone) === phone) ?? null;
}

export function maskPhone(phone: string) {
  const digits = normalizePhone(phone);
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}

/**
 * WhatsApp connections that may deliver a sign-in code, in order of preference:
 * the user's own workspace, then the system owner's, then any connected one.
 */
export async function senderCandidates(user: AuthAdmin) {
  const owner = await getOrCreateOwnerAdmin();
  return [...new Set([workspaceId(user), owner.id, ...whatsappWeb.connectedAdminIds()])];
}

export async function sendViaAnyConnection(user: AuthAdmin, text: string) {
  for (const senderId of await senderCandidates(user)) {
    if (await whatsappWeb.sendMessageToPhone(senderId, user.phone, text)) return true;
  }
  return false;
}

export type CodeRequestOutcome =
  | { kind: "sent"; destination: string }
  | { kind: "unknown" }
  | { kind: "throttled" }
  | { kind: "undeliverable" };

export async function requestLoginCode(identifier: string): Promise<CodeRequestOutcome> {
  const user = await findUserByIdentifier(identifier);
  if (!user) return { kind: "unknown" };
  const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(priceBotLoginCodes)
    .where(and(eq(priceBotLoginCodes.adminId, user.id), gt(priceBotLoginCodes.createdAt, new Date(Date.now() - codeWindowMs))));
  if (recent >= maxCodesPerWindow) return { kind: "throttled" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Only the newest code is valid.
  await db.update(priceBotLoginCodes).set({ consumedAt: new Date() })
    .where(and(eq(priceBotLoginCodes.adminId, user.id), isNull(priceBotLoginCodes.consumedAt)));
  const [row] = await db.insert(priceBotLoginCodes).values({
    adminId: user.id, codeHash: await hashCode(code), expiresAt: new Date(Date.now() + codeLifetimeMs),
  }).returning();
  const text = [
    "🔐 *קוד כניסה למחירון בוואטסאפ*",
    "",
    `הקוד שלך: *${code}*`,
    "",
    "הקוד בתוקף ל־5 דקות. אם לא ביקשת להתחבר, אפשר להתעלם מההודעה.",
  ].join("\n");
  if (!(await sendViaAnyConnection(user, text))) {
    await db.update(priceBotLoginCodes).set({ consumedAt: new Date() }).where(eq(priceBotLoginCodes.id, row.id));
    logger.warn({ adminId: user.id }, "No WhatsApp connection could deliver a login code");
    return { kind: "undeliverable" };
  }
  return { kind: "sent", destination: maskPhone(user.phone) };
}

export type CodeVerifyOutcome = { kind: "ok"; user: AuthAdmin } | { kind: "invalid"; userId?: number };

export async function verifyLoginCode(identifier: string, code: string): Promise<CodeVerifyOutcome> {
  const user = await findUserByIdentifier(identifier);
  if (!user || !/^\d{6}$/u.test(code)) return { kind: "invalid", userId: user?.id };
  const [row] = await db.select().from(priceBotLoginCodes)
    .where(and(eq(priceBotLoginCodes.adminId, user.id), isNull(priceBotLoginCodes.consumedAt), gt(priceBotLoginCodes.expiresAt, new Date())))
    .orderBy(desc(priceBotLoginCodes.createdAt)).limit(1);
  if (!row || row.attempts >= maxAttemptsPerCode) return { kind: "invalid", userId: user.id };
  if (!(await verifyCode(code, row.codeHash))) {
    await db.update(priceBotLoginCodes).set({ attempts: sql`${priceBotLoginCodes.attempts} + 1` }).where(eq(priceBotLoginCodes.id, row.id));
    return { kind: "invalid", userId: user.id };
  }
  // Single use, even under concurrent requests.
  const [consumed] = await db.update(priceBotLoginCodes).set({ consumedAt: new Date() })
    .where(and(eq(priceBotLoginCodes.id, row.id), isNull(priceBotLoginCodes.consumedAt))).returning();
  return consumed ? { kind: "ok", user } : { kind: "invalid", userId: user.id };
}
