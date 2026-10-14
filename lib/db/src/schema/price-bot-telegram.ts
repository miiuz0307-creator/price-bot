import { bigint, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { priceBotAdmins } from "./price-bot";

/** Everyone who has written to the Telegram bot (one row per Telegram user per workspace). */
export const priceBotTelegramUsers = pgTable("price_bot_telegram_users", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  username: text("username").notNull().default(""),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  lastChatType: text("last_chat_type").notNull().default("private"),
  lastChatTitle: text("last_chat_title").notNull().default(""),
  messageCount: integer("message_count").notNull().default(0),
  lastMessage: text("last_message").notNull().default(""),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("price_bot_telegram_users_admin_user_unique").on(table.adminId, table.telegramId)]);

export type PriceBotTelegramUser = typeof priceBotTelegramUsers.$inferSelect;
