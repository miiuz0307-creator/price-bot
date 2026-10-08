import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { priceBotAdmins } from "./price-bot";

/** Signed-in browser sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const priceBotSessions = pgTable("price_bot_sessions", {
  id: serial("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  adminId: integer("admin_id").notNull().references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  method: text("method").notNull().default("pin"),
  userAgent: text("user_agent").notNull().default(""),
  ip: text("ip").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [index("price_bot_sessions_admin_idx").on(table.adminId)]);

/** One-time login codes sent over WhatsApp. Only a hash is stored. */
export const priceBotLoginCodes = pgTable("price_bot_login_codes", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (table) => [index("price_bot_login_codes_admin_idx").on(table.adminId)]);

/** Who did what, for the owner's activity screen. */
export const priceBotAuditLog = pgTable("price_bot_audit_log", {
  id: serial("id").primaryKey(),
  actorId: integer("actor_id").references(() => priceBotAdmins.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull().default(""),
  targetId: text("target_id").notNull().default(""),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("price_bot_audit_log_created_idx").on(table.createdAt), index("price_bot_audit_log_actor_idx").on(table.actorId)]);

export type PriceBotSession = typeof priceBotSessions.$inferSelect;
export type PriceBotAuditEntry = typeof priceBotAuditLog.$inferSelect;
