import { createSign } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, priceBotAdmins, priceBotPushDevices } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Push notifications to the mobile app: Firebase Cloud Messaging (Android device
 * tokens, needs FIREBASE_SERVICE_ACCOUNT) or Expo's push service (Expo tokens).
 * Purely additive: if no phone registered, or the service is unreachable,
 * nothing else changes (WhatsApp notifications and the dashboard work as before).
 */
export type PushKind = "lookups" | "whatsapp" | "surge";
export type PushPreferences = Record<PushKind, boolean>;

export const defaultPushPreferences: PushPreferences = { lookups: true, whatsapp: true, surge: false };

export function pushPreferences(stored: Partial<PushPreferences> | null | undefined): PushPreferences {
  return { ...defaultPushPreferences, ...(stored ?? {}) };
}

export const isExpoPushToken = (token: string) => /^(ExponentPushToken|ExpoPushToken)\[[^\]]{10,200}\]$/u.test(token);

const expoPushUrl = () => process.env.EXPO_PUSH_URL ?? "https://exp.host/--/api/v2/push/send";

type PushMessage = { title: string; body: string; data?: Record<string, unknown> };

/** Sends to every active member of a WhatsApp workspace (owner of the number + users sharing it). */
export async function notifyWorkspace(workspaceAdminId: number, kind: PushKind, message: PushMessage) {
  if (process.env.PUSH_DISABLED === "1") return;
  try {
    const rows = await db.select({ token: priceBotPushDevices.token, preferences: priceBotPushDevices.preferences })
      .from(priceBotPushDevices)
      .innerJoin(priceBotAdmins, eq(priceBotAdmins.id, priceBotPushDevices.adminId))
      .where(and(eq(priceBotAdmins.active, true), or(eq(priceBotAdmins.id, workspaceAdminId), eq(priceBotAdmins.whatsappOwnerId, workspaceAdminId))));
    const tokens = rows.filter((row) => pushPreferences(row.preferences)[kind]).map((row) => row.token);
    const payload = { ...message, data: { kind, ...(message.data ?? {}) } };
    await Promise.all([
      sendPush(tokens.filter(isExpoPushToken), payload),
      sendFcm(tokens.filter((token) => !isExpoPushToken(token)), payload),
    ]);
  } catch (error) {
    logger.warn({ err: error, kind }, "Unable to send push notifications");
  }
}

export async function sendPush(tokens: string[], message: PushMessage) {
  const unregistered: string[] = [];
  for (let start = 0; start < tokens.length; start += 100) {
    const chunk = tokens.slice(start, start + 100);
    const response = await fetch(expoPushUrl(), {
      method: "POST",
      headers: {
        accept: "application/json", "content-type": "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(chunk.map((to) => ({
        to, title: message.title, body: message.body, data: message.data ?? {},
        sound: "default", priority: "high", channelId: "default",
      }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Push service rejected the request");
      continue;
    }
    const result = await response.json().catch(() => null) as { data?: { status: string; details?: { error?: string } }[] } | null;
    result?.data?.forEach((ticket, index) => {
      if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") unregistered.push(chunk[index]);
    });
  }
  if (unregistered.length) {
    await db.delete(priceBotPushDevices).where(inArray(priceBotPushDevices.token, unregistered));
  }
}

// ---- Firebase Cloud Messaging (HTTP v1) ----------------------------------

type ServiceAccount = { project_id: string; client_email: string; private_key: string; token_uri?: string };

export function firebaseServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!raw) return null;
  try {
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const account = JSON.parse(json) as ServiceAccount;
    return account.project_id && account.client_email && account.private_key ? account : null;
  } catch {
    logger.warn("FIREBASE_SERVICE_ACCOUNT is not valid JSON; push notifications to Android are off");
    return null;
  }
}

let cachedAccessToken: { value: string; expiresAt: number } | null = null;

async function fcmAccessToken(account: ServiceAccount) {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken.value;
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUri, iat: now, exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key.replace(/\\n/g, "\n"), "base64url");
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Firebase token request failed (${response.status})`);
  const result = await response.json() as { access_token: string; expires_in: number };
  cachedAccessToken = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return result.access_token;
}

export async function sendFcm(tokens: string[], message: PushMessage) {
  if (!tokens.length) return;
  const account = firebaseServiceAccount();
  if (!account) return;
  const accessToken = await fcmAccessToken(account);
  const url = process.env.FCM_SEND_URL ?? `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const data = Object.fromEntries(Object.entries(message.data ?? {}).map(([key, value]) => [key, String(value)]));
  const unregistered: string[] = [];
  await Promise.all(tokens.map(async (token) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ message: {
        token, notification: { title: message.title, body: message.body }, data,
        android: { priority: "HIGH", notification: { channel_id: "default", sound: "default" } },
      } }),
      signal: AbortSignal.timeout(10_000),
    }).catch((error) => { logger.warn({ err: error }, "FCM request failed"); return null; });
    if (!response || response.ok) return;
    const text = await response.text().catch(() => "");
    if (response.status === 404 || text.includes("UNREGISTERED")) unregistered.push(token);
    else logger.warn({ status: response.status, body: text.slice(0, 300) }, "FCM rejected a push notification");
  }));
  if (unregistered.length) {
    await db.delete(priceBotPushDevices).where(inArray(priceBotPushDevices.token, unregistered));
  }
}
