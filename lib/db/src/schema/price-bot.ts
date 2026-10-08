import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const priceBotProducts = pgTable("price_bot_products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("ILS"),
  aliases: text("aliases").array().notNull().default([]),
  distance: text("distance").notNull().default(""),
  duration: text("duration").notNull().default(""),
  level: text("level").notNull().default(""),
  priceMatrix: jsonb("price_matrix").$type<number[]>().notNull().default([]),
  waitTime: text("wait_time").notNull().default(""),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceBotAdmins = pgTable("price_bot_admins", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  label: text("label").notNull().default("מנהל"),
  role: text("role").notNull().default("admin"),
  active: boolean("active").notNull().default(true),
  codeHash: text("code_hash"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceBotTargets = pgTable("price_bot_targets", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  identifier: text("identifier").notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [unique("price_bot_targets_admin_identifier_unique").on(table.adminId, table.identifier)]);

export const priceBotLookups = pgTable("price_bot_lookups", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  from: text("from").notNull(),
  body: text("body").notNull(),
  matched: boolean("matched").notNull().default(false),
  estimate: jsonb("estimate").$type<{ name: string; distanceKm: number; priceMatrix: number[]; waitTime?: string }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceBotProductSchema = createInsertSchema(priceBotProducts);
export type PriceBotProduct = typeof priceBotProducts.$inferSelect;