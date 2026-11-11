import express, { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, priceBotAbbreviations, priceBotProducts, type PriceSection } from "@workspace/db";
import { findClosestProduct } from "../bot/search";
import { expandCustomAbbreviations, expandPlaceName, normalizeSearchText, normalizedSearchVariants } from "../services/catalog-search";
import { drivingRouteDetails, formatCatalogDistance, formatCatalogDuration } from "../services/route-estimate";
import { tokenOk } from "../services/app-updates";
import { stripProductLinks } from "../lib/strip-links";
import { logger } from "../lib/logger";

/**
 * Catalog maintenance from GitHub Actions (main branch, GitHub OIDC — same proof as
 * publishing app updates). "check" is read-only: which routes the bot already answers.
 * "import" only ADDS routes that the bot does not answer yet; it never changes or
 * deletes existing ones. "update" fills in text details (distance, time, price level,
 * wait, subtitle, notes) of a route found by its exact name; prices, aliases and the
 * route itself are never touched, and fields that are not sent stay as they are;
 * "removeAliases" removes only the listed wrong search names of that route.
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

type RouteDetails = { name: string; fromMaps?: boolean; removeAliases?: string[]; distance?: string; duration?: string; level?: string; waitTime?: string; subtitle?: string; notes?: string };

maintenanceRouter.post("/catalog/update", async (req, res, next) => {
  try {
    const routes = (req.body?.routes ?? []) as RouteDetails[];
    const updated: string[] = [];
    const notFound: string[] = [];
    for (const route of routes.slice(0, 200)) {
      const name = route.name?.trim();
      if (!name) continue;
      const fields: Partial<Record<"distance" | "duration" | "level" | "waitTime" | "subtitle" | "notes", string>> = {};
      for (const field of ["distance", "duration", "level", "waitTime", "subtitle", "notes"] as const) {
        const value = route[field];
        if (typeof value === "string") fields[field] = stripProductLinks({ [field]: value.trim() })[field];
      }
      if (route.fromMaps) {
        // Distance and time again from Google Maps, by the full town names of the route.
        const abbreviations = await db.select({ shortcut: priceBotAbbreviations.shortcut, expansion: priceBotAbbreviations.expansion }).from(priceBotAbbreviations);
        const ends = name.split("⇔").map((part) => expandPlaceName(part, abbreviations));
        const details = ends.length === 2 && ends.every(Boolean) ? await drivingRouteDetails(ends[0], ends[1]).catch(() => null) : null;
        if (details) {
          fields.distance = formatCatalogDistance(details.distanceKm);
          fields.duration = formatCatalogDuration(details.minutes);
        }
      }
      // Remove wrong search names (aliases) of this route — only the ones listed, exactly.
      let aliases: string[] | undefined;
      if (route.removeAliases?.length) {
        const [current] = await db.select({ aliases: priceBotProducts.aliases }).from(priceBotProducts).where(eq(priceBotProducts.name, name));
        const remove = new Set(route.removeAliases.map(normalizeSearchText));
        if (current) aliases = current.aliases.filter((alias) => !remove.has(normalizeSearchText(alias)));
      }
      if (!Object.keys(fields).length && !aliases) { notFound.push(`${name} (no details)`); continue; }
      const rows = await db.update(priceBotProducts).set({ ...fields, ...(aliases ? { aliases } : {}) }).where(eq(priceBotProducts.name, name)).returning({ name: priceBotProducts.name });
      if (rows.length) updated.push(name); else notFound.push(name);
    }
    logger.info({ updated: updated.length, notFound: notFound.length }, "Catalog details update from maintenance");
    res.json({ updated, notFound });
  } catch (error) {
    next(error);
  }
});
