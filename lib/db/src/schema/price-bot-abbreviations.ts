import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const priceBotAbbreviations = pgTable("price_bot_abbreviations", {
  id: serial("id").primaryKey(),
  shortcut: text("shortcut").notNull(),
  normalizedShortcut: text("normalized_shortcut").notNull().unique(),
  expansion: text("expansion").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceBotAbbreviationSchema = createInsertSchema(priceBotAbbreviations).omit({
  id: true,
  updatedAt: true,
});
export type PriceBotAbbreviation = typeof priceBotAbbreviations.$inferSelect;