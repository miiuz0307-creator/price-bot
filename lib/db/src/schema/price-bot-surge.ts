import { boolean, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { priceBotAdmins, priceBotProducts } from "./price-bot";

export const priceBotSurgeSettings = pgTable("price_bot_surge_settings", {
  adminId: integer("admin_id").primaryKey().references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(false),
  groupIdentifiers: text("group_identifiers").array().notNull().default([]),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

export const priceBotSurgeOffers = pgTable("price_bot_surge_offers", {
  id: serial("id").primaryKey(),
  adminId: integer("admin_id").notNull().references(() => priceBotAdmins.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => priceBotProducts.id, { onDelete: "cascade" }),
  price: integer("price").notNull(),
  vehicleType: text("vehicle_type").notNull().default("regular"),
  extraPassenger: boolean("extra_passenger").notNull().default(false),
  directionKey: text("direction_key").notNull().default(""),
  quotedRoute: text("quoted_route").notNull().default(""),
  groupIdentifier: text("group_identifier").notNull(),
  observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (table) => [unique("price_bot_surge_offers_direction_variant_unique").on(table.adminId, table.productId, table.vehicleType, table.extraPassenger, table.directionKey)]);

export const insertPriceBotSurgeSettingsSchema = createInsertSchema(priceBotSurgeSettings);
export const insertPriceBotSurgeOfferSchema = createInsertSchema(priceBotSurgeOffers);
export type PriceBotSurgeSettings = typeof priceBotSurgeSettings.$inferSelect;
export type PriceBotSurgeOffer = typeof priceBotSurgeOffers.$inferSelect;