import express, { Router, type IRouter } from "express";
import { db, priceBotAbbreviations, priceBotProducts, type PriceSection } from "@workspace/db";
import { findClosestProduct } from "../bot/search";
import { expandCustomAbbreviations, normalizedSearchVariants } from "../services/catalog-search";
import { tokenOk } from "../services/app-updates";
import { stripProductLinks } from "../lib/strip-links";
import { logger } from "../lib/logger";

/**
 * Catalog maintenance from GitHub Actions (main branch, GitHub OIDC — same proof as
 * publishing app updates). "check" is read-only: which routes the bot already answers.
 * "import" only ADDS routes that the bot does not answer yet; it never changes or
 * deletes existing ones.
 */
export const maintenanceRouter: IRouter = Router();
maintenanceRouter.use(express.json({ limit: "5mb" }));
maintenanceRouter.use(async (req, res, next) => {
  if (await tokenOk(req)) return next();
  res.status(401).json({ error: "unauthorized" });
});

type Check = { key: string; queries: string[] };
type NewRoute = {
  name: string; aliases?: string[]; priceMatrix: number[]; distance?: string; duration?: string; level?: string;
  waitTime?: string; subtitle?: string; notes?: string; sections?: PriceSection[];
};

async function matcher() {
  const [products, abbreviations] = await Promise.all([
    db.select().from(priceBotProducts),
    db.select({ shortcut: priceBotAbbreviations.shortcut, expansion: priceBotAbbreviations.expansion }).from(priceBotAbbreviations),
  ]);
  const match = (query: string) => {
    const text = query.replace(/^מ\s+/u, "").trim();
    if (!text) return null;
    const result = findClosestProduct(products, expandCustomAbbreviations(text, abbreviations), false);
    return result?.kind === "match" && !result.corrected ? result.product : null;
  };
  return { products, abbreviations, match };
}

maintenanceRouter.post("/catalog/check", async (req, res, next) => {
  try {
    const checks = (req.body?.checks ?? []) as Check[];
    const { products, abbreviations, match } = await matcher();
    const results = checks.map((check) => {
      const hit = check.queries.map((query) => ({ query, product: match(query) })).find((item) => item.product);
      return { key: check.key, matched: hit?.product?.name ?? null, active: hit?.product?.active ?? null, via: hit?.query ?? null };
    });
    res.json({
      products: products.map((product) => ({ name: product.name, active: product.active, aliases: product.aliases, priceMatrix: product.priceMatrix })),
      abbreviations,
      results,
    });
  } catch (error) {
    next(error);
  }
});

maintenanceRouter.post("/catalog/import", async (req, res, next) => {
  try {
    const routes = (req.body?.routes ?? []) as NewRoute[];
    const { match } = await matcher();
    const created: string[] = [];
    const skipped: { name: string; existing: string }[] = [];
    for (const route of routes.slice(0, 200)) {
      const prices = route.priceMatrix?.map(Number) ?? [];
      if (!route.name?.trim() || !(prices.length === 8 || prices.length === 1) || prices.some((price) => !Number.isFinite(price) || price <= 0)) continue;
      const existing = [route.name, ...(route.aliases ?? [])].map(match).find(Boolean);
      if (existing) { skipped.push({ name: route.name, existing: existing.name }); continue; }
      const clean = stripProductLinks({
        name: route.name.trim(), aliases: [...new Set((route.aliases ?? []).map((alias) => alias.trim()).filter((alias) => alias && alias !== route.name))],
        distance: route.distance ?? "", duration: route.duration ?? "", level: route.level ?? "", waitTime: route.waitTime ?? "",
        subtitle: route.subtitle ?? "", notes: route.notes ?? "", sections: route.sections ?? [],
      });
      await db.insert(priceBotProducts).values({ ...clean, price: String(prices[0]), currency: "ILS", priceMatrix: prices, active: true });
      created.push(clean.name);
    }
    logger.info({ created: created.length, skipped: skipped.length }, "Catalog import from maintenance");
    res.json({ created, skipped });
  } catch (error) {
    next(error);
  }
});
