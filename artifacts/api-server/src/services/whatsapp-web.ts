import { cp, existsSync, rename } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import makeWASocket, {
  DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser, normalizeMessageContent,
  useMultiFileAuthState, type BinaryNode, type GroupMetadata, type WASocket, type WAMessage,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { logger } from "../lib/logger";
import { WhatsAppIngressTiming } from "./whatsapp-ingress-timing";
import { makeSafeCacheableSignalKeyStore } from "./whatsapp-key-cache";

export type WhatsAppConnectionState = "disconnected" | "initializing" | "qr_ready" | "pairing_code_ready" | "connected" | "error";
export type IncomingWhatsAppMessage = { adminId: number; from: string; chatId: string; isGroup: boolean; body: string; sentAt?: number; isHistory?: boolean };
export type WhatsAppGroup = { identifier: string; label: string };
type MessageHandler = (message: IncomingWhatsAppMessage) => Promise<{ responseText: string } | null>;
type Connection = {
  client: WASocket | null; initializePromise: Promise<void> | null; state: WhatsAppConnectionState;
  qrCode: string | null; pairingCode: string | null; phoneNumber: string | null; lastError: string | null;
  intentionalDisconnect: boolean; statusChecked: boolean; recentGroups: Map<string, string>; reconnectTimer: NodeJS.Timeout | null;
  reconnectAttempts: number; lastGroupSyncAt: number;
  groupMetadataCache: Map<string, { metadata: GroupMetadata; expiresAt: number }>;
  groupMetadataRequests: Map<string, Promise<GroupMetadata>>;
};

const groupMetadataLifetimeMs = 5 * 60_000;
const legacyAuthPaths = [
  path.resolve(process.cwd(), ".local/price-bot-whatsapp-auth"),
  path.resolve(process.cwd(), "artifacts/api-server/.local/price-bot-whatsapp-auth"),
];
const authRoot = path.resolve(process.cwd(), ".local/price-bot-whatsapp-admins");
const authPathFor = (adminId: number) => path.join(authRoot, `admin-${adminId}`);
const blankConnection = (): Connection => ({
  client: null, initializePromise: null, state: "disconnected", qrCode: null, pairingCode: null,
  phoneNumber: null, lastError: null, intentionalDisconnect: false, statusChecked: false,
  recentGroups: new Map(), reconnectTimer: null, reconnectAttempts: 0, lastGroupSyncAt: 0,
  groupMetadataCache: new Map(), groupMetadataRequests: new Map(),
});
function plainIdentifier(value: string) { return value.replace(/:\d+@/u, "@").replace(/@(s\.whatsapp\.net|g\.us|lid)$/iu, ""); }
function phoneJid(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return `${digits}@s.whatsapp.net`;
}
function messageText(message: WAMessage) {
  const content = normalizeMessageContent(message.message);
  return (content?.conversation || content?.extendedTextMessage?.text || content?.imageMessage?.caption || content?.videoMessage?.caption || "").trim();
}

class WhatsAppWebManager {
  private connections = new Map<number, Connection>();
  private messageHandler: MessageHandler | null = null;
  private legacyMigrated = false;
  private connection(adminId: number) {
    let connection = this.connections.get(adminId);
    if (!connection) { connection = blankConnection(); this.connections.set(adminId, connection); }
    return connection;
  }
  registerMessageHandler(handler: MessageHandler) { this.messageHandler = handler; }
  private async migrateLegacyAuth(adminId: number) {
    const legacyAuthPath = legacyAuthPaths.find((candidate) => existsSync(candidate));
    if (this.legacyMigrated || !legacyAuthPath || existsSync(authPathFor(adminId))) return;
    this.legacyMigrated = true;
    await mkdir(authRoot, { recursive: true });
    const temporaryAuthPath = `${authPathFor(adminId)}.tmp`;
    try {
      // The legacy auth folder and persistent auth root can be mounted on
      // different filesystems in production, so copy first and only rename
      // within the destination filesystem.
      await rm(temporaryAuthPath, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => cp(legacyAuthPath, temporaryAuthPath, { recursive: true, errorOnExist: true }, (error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve, reject) => rename(temporaryAuthPath, authPathFor(adminId), (error) => error ? reject(error) : resolve()));
    } catch (error) {
      logger.warn({ err: error, adminId }, "Unable to migrate legacy WhatsApp auth");
      await rm(temporaryAuthPath, { recursive: true, force: true });
    }
  }
  async getStatus(adminId: number, migrateLegacy = false) {
    const connection = this.connection(adminId);
    if (!connection.statusChecked) {
      connection.statusChecked = true;
      if (migrateLegacy) await this.migrateLegacyAuth(adminId);
      // A published bot and the development preview must never use the same
      // Baileys session concurrently; WhatsApp replaces one with the other.
      if (process.env.NODE_ENV === "production" && existsSync(authPathFor(adminId))) {
        void this.connect(adminId);
      }
    }
    return this.status(connection);
  }
  async connect(adminId: number, migrateLegacy = false) {
    const connection = this.connection(adminId);
    if (migrateLegacy) await this.migrateLegacyAuth(adminId);
    if (connection.client || connection.initializePromise) return this.status(connection);
    connection.intentionalDisconnect = false; connection.state = "initializing"; connection.qrCode = null; connection.pairingCode = null; connection.lastError = null;
    connection.initializePromise = this.initialize(adminId, connection).catch((error) => {
      logger.warn({ err: error, adminId }, "Baileys WhatsApp initialization failed");
      connection.state = "error"; connection.lastError = "לא ניתן היה להפעיל את חיבור WhatsApp. נסו להתחבר מחדש."; connection.client = null;
    }).finally(() => { connection.initializePromise = null; });
    return this.status(connection);
  }
  async connectFresh(adminId: number) {
    const connection = this.connection(adminId);
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    const client = connection.client;
    Object.assign(connection, blankConnection());
    if (client) await client.end(undefined).catch(() => undefined);
    await rm(authPathFor(adminId), { recursive: true, force: true });
    return this.connect(adminId);
  }
  private async cachedGroupMetadata(connection: Connection, client: WASocket, jid: string) {
    const cached = connection.groupMetadataCache.get(jid);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    const pending = connection.groupMetadataRequests.get(jid);
    if (pending) return pending;
    const request = client.groupMetadata(jid).then((metadata) => {
      if (connection.client === client) {
        connection.groupMetadataCache.set(jid, { metadata, expiresAt: Date.now() + groupMetadataLifetimeMs });
        connection.recentGroups.set(plainIdentifier(jid), metadata.subject || "קבוצה ללא שם");
      }
      return metadata;
    }).finally(() => {
      if (connection.groupMetadataRequests.get(jid) === request) connection.groupMetadataRequests.delete(jid);
    });
    connection.groupMetadataRequests.set(jid, request);
    return request;
  }
  private async initialize(adminId: number, connection: Connection) {
    const { state: authState, saveCreds } = await useMultiFileAuthState(authPathFor(adminId));
    const { version } = await fetchLatestBaileysVersion();
    const providerLogger = logger.child({ provider: "baileys", adminId });
    const ingressTiming = new WhatsAppIngressTiming();
    connection.groupMetadataCache.clear();
    connection.groupMetadataRequests.clear();
    let client: WASocket;
    client = makeWASocket({
      version,
      // Cache hot keys only after durable writes, using the same auth files.
      auth: { creds: authState.creds, keys: makeSafeCacheableSignalKeyStore(authState.keys) },
      printQRInTerminal: false, markOnlineOnConnect: false,
      syncFullHistory: false, generateHighQualityLinkPreview: false,
      cachedGroupMetadata: (jid) => this.cachedGroupMetadata(connection, client, jid),
      logger: providerLogger,
    });
    client.ws.on("CB:message", (node: BinaryNode) => {
      ingressTiming.record(jidNormalizedUser(node.attrs.from ?? ""), node.attrs.id ?? "", Boolean(node.attrs.offline));
    });
    connection.client = client;
    client.ev.on("creds.update", saveCreds);
    client.ev.on("connection.update", (update) => void this.handleConnectionUpdate(adminId, connection, client, update));
    client.ev.on("group-participants.update", ({ id }) => connection.groupMetadataCache.delete(id));
    client.ev.on("groups.update", (groups) => {
      for (const group of groups) if (group.id) connection.groupMetadataCache.delete(group.id);
    });
    client.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const message of messages) {
        const isHistory = type === "append";
        const sentAt = Number(message.messageTimestamp) * 1000;
        // Offline group redeliveries can arrive as "append". Only consider
        // recent group offers; never replay private commands or old replies.
        if (isHistory && (!message.key.remoteJid?.endsWith("@g.us")
          || !Number.isFinite(sentAt) || Date.now() - sentAt > 5 * 60_000)) continue;
        void this.handleMessage(adminId, connection, client, message, isHistory, ingressTiming);
      }
    });
  }
  private async handleConnectionUpdate(adminId: number, connection: Connection, client: WASocket, update: { connection?: "close" | "connecting" | "open"; lastDisconnect?: { error?: Error }; qr?: string }) {
    if (connection.client !== client) return;
    if (update.qr) { connection.qrCode = await QRCode.toDataURL(update.qr); if (!connection.pairingCode) connection.state = "qr_ready"; }
    if (update.connection === "open") { connection.phoneNumber = plainIdentifier(jidNormalizedUser(client.user?.id ?? "")); connection.qrCode = null; connection.pairingCode = null; connection.lastError = null; connection.reconnectAttempts = 0; connection.state = "connected"; return; }
    if (update.connection !== "close") return;
    const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
    const wasLinked = Boolean(client.authState?.creds?.me);
    connection.client = null; connection.qrCode = null; connection.pairingCode = null; connection.phoneNumber = null;
    if (connection.intentionalDisconnect) { connection.state = "disconnected"; connection.lastError = null; return; }
    if (statusCode === DisconnectReason.loggedOut) {
      // The device was removed from the phone. The saved keys are now useless and
      // would make every restart fail, so delete them and wait for a new QR scan.
      connection.state = "disconnected"; connection.lastError = "החיבור נותק מ-WhatsApp. התחברו מחדש.";
      await rm(authPathFor(adminId), { recursive: true, force: true }).catch((error) => logger.warn({ err: error, adminId }, "Unable to remove logged-out WhatsApp auth"));
      return;
    }
    if (statusCode === DisconnectReason.connectionReplaced) {
      // Another server (e.g. dev and production) opened the same session.
      // Reconnecting would make the two fight forever, so stop here.
      connection.state = "error"; connection.lastError = "החיבור נפתח במקום אחר (שרת או סביבה נוספת). סגרו את החיבור השני ולחצו על חיבור מחדש.";
      logger.warn({ adminId }, "WhatsApp session replaced by another connection; not reconnecting");
      return;
    }
    if (!wasLinked && (statusCode === DisconnectReason.timedOut || statusCode === DisconnectReason.forbidden)) {
      // Nobody scanned the QR code in time. Stop generating new codes in the background.
      connection.state = "disconnected"; connection.lastError = "תוקף קוד החיבור פג. לחצו שוב על „חיבור WhatsApp” כדי לקבל קוד חדש.";
      await rm(authPathFor(adminId), { recursive: true, force: true }).catch(() => undefined);
      return;
    }
    connection.state = "initializing";
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    const reconnectDelay = Math.min(5 * 60_000, 2_000 * 2 ** Math.min(connection.reconnectAttempts, 8));
    connection.reconnectAttempts += 1;
    logger.warn({ adminId, reconnectDelay, reconnectAttempts: connection.reconnectAttempts }, "Scheduling WhatsApp reconnect");
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      void this.connect(adminId);
    }, reconnectDelay);
  }
  async disconnect(adminId: number) {
    const connection = this.connection(adminId); connection.intentionalDisconnect = true;
    if (connection.reconnectTimer) clearTimeout(connection.reconnectTimer);
    const client = connection.client; Object.assign(connection, blankConnection());
    if (client) await client.logout().catch(() => client.end(undefined).catch(() => undefined));
    await rm(authPathFor(adminId), { recursive: true, force: true });
    return this.status(connection);
  }
  /** Close every socket for a server restart. Does NOT log out: sessions resume on the next start. */
  async shutdown() {
    await Promise.all([...this.connections.entries()].map(async ([adminId, connection]) => {
      connection.intentionalDisconnect = true;
      if (connection.reconnectTimer) { clearTimeout(connection.reconnectTimer); connection.reconnectTimer = null; }
      const client = connection.client;
      if (!client) return;
      await client.end(undefined).catch((error: unknown) => logger.warn({ err: error, adminId }, "Unable to close WhatsApp socket"));
    }));
  }
  async sendMessageToPhone(adminId: number, phone: string, text: string) {
    const connection = this.connection(adminId);
    if (!connection.client || connection.state !== "connected") return false;
    try { await connection.client.sendMessage(phoneJid(phone), { text }); return true; } catch (error) { logger.warn({ err: error, adminId }, "Unable to send WhatsApp admin notification"); return false; }
  }
  async listGroups(adminId: number): Promise<WhatsAppGroup[]> {
    const connection = this.connection(adminId);
    if (connection.client && connection.state === "connected" && Date.now() - connection.lastGroupSyncAt > 60_000) {
      try {
        const groups = await connection.client.groupFetchAllParticipating();
        for (const group of Object.values(groups)) {
          const identifier = plainIdentifier(group.id);
          connection.recentGroups.set(identifier, group.subject || "קבוצה ללא שם");
          connection.groupMetadataCache.set(group.id, { metadata: group, expiresAt: Date.now() + groupMetadataLifetimeMs });
        }
        connection.lastGroupSyncAt = Date.now();
      } catch (error) {
        logger.warn({ err: error, adminId }, "Unable to fully synchronize WhatsApp groups");
      }
    }
    return [...connection.recentGroups.entries()]
      .sort((left, right) => left[1].localeCompare(right[1], "he"))
      .map(([identifier, label]) => ({ identifier, label }));
  }
  private status(connection: Connection) { return { connected: connection.state === "connected", provider: "WhatsApp Web (Baileys)", phoneNumber: connection.phoneNumber, webhookConfigured: true, connectionState: connection.state, qrCode: connection.qrCode, pairingCode: connection.pairingCode, lastError: connection.lastError }; }
  private async handleMessage(adminId: number, connection: Connection, client: WASocket, message: WAMessage, isHistory = false, ingressTiming?: WhatsAppIngressTiming) {
    const receivedAt = Date.now();
    const remoteJid = message.key.remoteJid ?? ""; const body = messageText(message); const isGroup = remoteJid.endsWith("@g.us");
    if (message.key.fromMe && body.startsWith("📍 *בקשת מחיר ללא מחיר במחירון*")) return;
    const remoteIdentifier = plainIdentifier(jidNormalizedUser(remoteJid));
    const ownIdentifiers = [client.user?.id, client.user?.lid]
      .filter((identifier): identifier is string => Boolean(identifier))
      .map((identifier) => plainIdentifier(jidNormalizedUser(identifier)));
    const isSelfChat = Boolean(message.key.fromMe && ownIdentifiers.includes(remoteIdentifier));
    if ((message.key.fromMe && !isSelfChat) || !this.messageHandler || !body) return;
    const ingress = ingressTiming?.consume(jidNormalizedUser(remoteJid), message.key.id ?? "");
    const sentAt = Number(message.messageTimestamp) * 1000;
    const timingFields = {
      messageId: message.key.id,
      transportToHandlerMs: ingress ? receivedAt - ingress.lastReceivedAt : undefined,
      upstreamAgeMs: ingress && Number.isFinite(sentAt) ? ingress.firstReceivedAt - sentAt : undefined,
      recoveryWaitMs: ingress ? ingress.lastReceivedAt - ingress.firstReceivedAt : undefined,
      inboundDeliveries: ingress?.deliveries,
      offlineDelivery: ingress?.offline ?? isHistory,
    };
    if (!isHistory && /^מ\s+.+/u.test(body)) {
      logger.info({ adminId, isGroup, ...timingFields, messageAgeMs: receivedAt - sentAt }, "Received WhatsApp price request");
    }
    if (isGroup) {
      const identifier = plainIdentifier(remoteJid);
      const label = connection.groupMetadataCache.get(remoteJid)?.metadata.subject
        || connection.recentGroups.get(identifier) || "קבוצה ללא שם";
      connection.recentGroups.delete(identifier);
      connection.recentGroups.set(identifier, label);
    }
    const senderJid = isGroup ? message.key.participantAlt || message.key.participant || remoteJid : message.key.remoteJidAlt || remoteJid;
    let sender = plainIdentifier(jidNormalizedUser(senderJid));
    if (senderJid.endsWith("@lid")) sender = plainIdentifier((await client.signalRepository.lidMapping.getPNForLID(jidNormalizedUser(senderJid)).catch(() => null)) || senderJid);
    try {
      const result = await this.messageHandler({ adminId, from: sender, chatId: isGroup ? plainIdentifier(remoteJid) : sender, isGroup, body, sentAt: Number(message.messageTimestamp) * 1000, isHistory });
      if (result?.responseText) {
        const processedAt = Date.now();
        // Reply on the exact inbound chat address. New WhatsApp accounts often
        // use an LID as the primary address; a PN JID can be accepted by the
        // server without delivering into that LID conversation.
        const replyJid = remoteJid;
        await client.sendMessage(replyJid, { text: result.responseText }, isGroup ? { quoted: message } : undefined);
        logger.info({
          adminId, isGroup, replyTo: sender, addressType: remoteJid.endsWith("@lid") ? "lid" : "phone",
          processingMs: processedAt - receivedAt, sendingMs: Date.now() - processedAt,
          messageAgeMs: Date.now() - Number(message.messageTimestamp) * 1000,
          ...timingFields,
        }, "Sent WhatsApp bot response");
      }
    } catch (error) {
      logger.error({ err: error, adminId, isGroup }, "Unable to process inbound WhatsApp message");
    }
  }
}
export const whatsappWeb = new WhatsAppWebManager();