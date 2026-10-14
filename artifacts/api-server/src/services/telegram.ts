import { desc, eq, sql } from "drizzle-orm";
import { db, priceBotTelegramUsers } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Telegram channel for the same price bot: same catalog, same replies, same
 * request log. Turned on by TELEGRAM_BOT_TOKEN (from @BotFather); it uses long
 * polling, so no public webhook or extra setup is needed. Without the token
 * nothing here runs.
 */
type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
};
type Update = { update_id: number; message?: TelegramMessage };

export type TelegramReplyHandler = (message: {
  chatId: string; from: string; body: string; isGroup: boolean; chatTitle: string;
}) => Promise<string | null>;

/** WhatsApp formatting (*bold*, _italic_, ~strike~, `code`) → Telegram HTML. */
export function whatsappToTelegramHtml(text: string) {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g, "$1<i>$2</i>")
    .replace(/~([^~\n]+)~/g, "<s>$1</s>");
}

class TelegramBot {
  private token = "";
  private offset = 0;
  private running = false;
  private abort: AbortController | null = null;
  private handler: TelegramReplyHandler | null = null;
  private workspaceId: number | null = null;
  username: string | null = null;
  lastError: string | null = null;

  get configured() { return Boolean(this.token); }

  private async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(20_000),
    });
    const result = await response.json().catch(() => null) as { ok: boolean; result: T; description?: string } | null;
    if (!result?.ok) throw new Error(result?.description ?? `Telegram ${method} failed (${response.status})`);
    return result.result;
  }

  async start(handler: TelegramReplyHandler, options: { workspaceId?: number } = {}) {
    this.workspaceId = options.workspaceId ?? null;
    this.token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
    if (!this.token || this.running) return;
    this.handler = handler;
    this.running = true;
    try {
      const me = await this.call<{ username: string }>("getMe", {});
      this.username = me.username;
      // Long polling only works without a webhook.
      await this.call("deleteWebhook", { drop_pending_updates: false });
      logger.info({ username: me.username }, "Telegram bot connected");
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      logger.warn({ err: error }, "Telegram bot could not start (check TELEGRAM_BOT_TOKEN)");
      this.running = false;
      return;
    }
    void this.poll();
  }

  private async poll() {
    let delay = 1000;
    let failures = 0;
    while (this.running) {
      try {
        this.abort = new AbortController();
        const timer = setTimeout(() => this.abort?.abort(), 40_000);
        const updates = await this.call<Update[]>("getUpdates", { offset: this.offset, timeout: 25, allowed_updates: ["message"] }, this.abort.signal);
        clearTimeout(timer);
        this.lastError = null;
        delay = 1000;
        failures = 0;
        for (const update of updates) {
          this.offset = update.update_id + 1;
          if (update.message) void this.handle(update.message);
        }
      } catch (error) {
        if (!this.running) break;
        const cause = (error as { cause?: { code?: string; message?: string } })?.cause;
        const message = [error instanceof Error ? error.message : String(error), cause?.code ?? cause?.message].filter(Boolean).join(": ");
        // 409 = another copy of the server is polling (a deploy is switching over): wait.
        this.lastError = message;
        // A dropped long-poll connection now and then is normal; only report a real outage.
        failures += 1;
        if (failures >= 3 && !/abort/i.test(message)) logger.warn({ err: message, failures }, "Telegram polling error");
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    }
  }

  private async handle(message: TelegramMessage) {
    const text = message.text?.trim();
    if (!text || message.from?.is_bot || !this.handler) return;
    const isGroup = message.chat.type === "group" || message.chat.type === "supergroup";
    void this.remember(message, text);
    try {
      if (/^\/(start|help)(@\w+)?$/u.test(text)) {
        await this.send(message.chat.id, "שלום! 👋\nלבדיקת מחיר שלחו: <b>מ</b> ואחריו המסלול, למשל:\n<code>מ בני ברק ירושלים</code>", message.message_id);
        return;
      }
      const from = message.from?.username ? `tg:@${message.from.username}` : `tg:${message.from?.id ?? message.chat.id}`;
      const reply = await this.handler({
        chatId: `tg:${message.chat.id}`, from, body: text.replace(new RegExp(`@${this.username ?? "_"}\\b`, "g"), "").trim(), isGroup,
        chatTitle: message.chat.title ?? [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" "),
      });
      if (reply) await this.send(message.chat.id, whatsappToTelegramHtml(reply), message.message_id);
    } catch (error) {
      logger.warn({ err: error, chat: message.chat.id }, "Telegram reply failed");
    }
  }

  async send(chatId: number | string, html: string, replyTo?: number) {
    for (const chunk of html.match(/[\s\S]{1,4000}(?=\n|$)|[\s\S]{1,4000}/g) ?? [html]) {
      await this.call("sendMessage", {
        chat_id: chatId, text: chunk, parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
      });
    }
  }

  /** Keeps the list of people using the bot (shown in the app and website). Never blocks a reply. */
  private async remember(message: TelegramMessage, text: string) {
    const user = message.from;
    if (!user || this.workspaceId === null) return;
    const now = new Date();
    const values = {
      username: user.username ?? "", firstName: user.first_name ?? "", lastName: user.last_name ?? "",
      lastChatType: message.chat.type, lastChatTitle: message.chat.title ?? "",
      lastMessage: text.slice(0, 300), lastSeenAt: now,
    };
    try {
      await db.insert(priceBotTelegramUsers)
        .values({ adminId: this.workspaceId, telegramId: user.id, messageCount: 1, firstSeenAt: now, ...values })
        .onConflictDoUpdate({
          target: [priceBotTelegramUsers.adminId, priceBotTelegramUsers.telegramId],
          set: { ...values, messageCount: sql`${priceBotTelegramUsers.messageCount} + 1` },
        });
    } catch (error) {
      logger.warn({ err: error }, "Unable to record Telegram user");
    }
  }

  async users(workspaceId: number) {
    return db.select().from(priceBotTelegramUsers)
      .where(eq(priceBotTelegramUsers.adminId, workspaceId))
      .orderBy(desc(priceBotTelegramUsers.lastSeenAt))
      .limit(1000);
  }

  stop() {
    this.running = false;
    this.abort?.abort();
  }

  status() {
    return { configured: this.configured, connected: Boolean(this.username) && !this.lastError, username: this.username, lastError: this.lastError };
  }
}

export const telegramBot = new TelegramBot();
