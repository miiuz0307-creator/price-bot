import { expandCustomAbbreviations, isBuiltInAbbreviation, normalizeSearchText, normalizedSearchVariants } from "./catalog-search";

type Product = { id: number; name: string; aliases: string[]; active: boolean; price: string; priceMatrix: number[]; currency: string };

export const surgeLifetimeMs = 10 * 60_000;

export function surgeEffectiveExpiry(offer: { observedAt: Date; expiresAt: Date }) {
  return new Date(Math.min(offer.expiresAt.getTime(), offer.observedAt.getTime() + surgeLifetimeMs));
}

export function isSurgeActiveAt(offer: { observedAt: Date; expiresAt: Date }, now: Date) {
  return surgeEffectiveExpiry(offer).getTime() > now.getTime();
}

export function surgeDisplayedPrice(offer: { price: number; extraPassenger: boolean }) {
  return offer.price + (offer.extraPassenger ? 20 : 0);
}

export function formatSurgePrice(offer: { price: number; extraPassenger: boolean }) {
  return `₪${surgeDisplayedPrice(offer).toLocaleString("he-IL")}${offer.extraPassenger ? " מעל" : ""}`;
}

const vehicleOrder: Record<string, number> = {
  regular: 0,
  small_minivan: 1,
  roomy_six: 2,
  sienna: 3,
};

export function sortSurgeOffers<T extends { vehicleType: string; extraPassenger: boolean }>(offers: readonly T[]): T[] {
  return [...offers].sort((left, right) =>
    (vehicleOrder[left.vehicleType] ?? 4) - (vehicleOrder[right.vehicleType] ?? 4)
    || Number(left.extraPassenger) - Number(right.extraPassenger));
}

export function surgeDirectionKey(
  route: { origin: string; destination: string },
  abbreviations: readonly { shortcut: string; expansion: string }[] = [],
): string | null {
  const key = (place: string) => normalizedSearchVariants(expandCustomAbbreviations(place, abbreviations))[0];
  const origin = key(route.origin);
  const destination = key(route.destination);
  return origin && destination && origin !== destination ? `${origin}→${destination}` : null;
}

export function matchesSurgeDirection(
  offer: { directionKey: string },
  route: { origin: string; destination: string } | null,
  abbreviations: readonly { shortcut: string; expansion: string }[] = [],
) {
  return !!route && !!offer.directionKey && offer.directionKey === surgeDirectionKey(route, abbreviations);
}

export function isSurgeAboveCatalog(
  offer: { price: number; vehicleType: string },
  product: { price: string; priceMatrix: number[] },
) {
  const tier = { regular: 0, small_minivan: 2, roomy_six: 4, sienna: 6 }[offer.vehicleType];
  if (tier === undefined) return false;
  const catalogPrice = tier === 0 ? product.priceMatrix[0] ?? Number(product.price) : product.priceMatrix[tier];
  return Number.isFinite(catalogPrice) && catalogPrice > 0 && offer.price > catalogPrice;
}

function findMentionedRoute(text: string, places: ReadonlySet<string>) {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const mentions: string[] = [];
  for (let index = 0; index < words.length; index++) {
    for (let length = Math.min(5, words.length - index); length >= 1; length--) {
      const phrase = words.slice(index, index + length).join(" ");
      const first = words[index];
      const withoutPrefix = /^[מל][\p{L}]{2,}$/u.test(first)
        ? [first.slice(1), ...words.slice(index + 1, index + length)].join(" ") : null;
      const place = [phrase, withoutPrefix].find((candidate) =>
        candidate && (places.has(normalizeSearchText(candidate)) || (length === 1 && isBuiltInAbbreviation(candidate))));
      if (!place) continue;
      if (length === 1 && normalizeSearchText(place) === normalizeSearchText("ים")
        && normalizeSearchText(words[index + 1] ?? "") === normalizeSearchText("המלח")) continue;
      mentions.push(place);
      index += length - 1;
      break;
    }
  }
  return mentions.length === 2 ? { origin: mentions[0], destination: mentions[1] } : null;
}

export function parseSurgeQuote(body: string, knownPlaces: readonly string[]) {
  if (body.length > 20_000) return null;
  // Group signatures often contain WhatsApp links with "?text=" and hundreds of
  // invisible direction marks. Neither is part of the actual price quote.
  const message = body
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "")
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\/[^\s]+/giu, " ");
  const lines = message.split(/\r?\n/u).map((part) => part.trim()).filter(Boolean);
  if (!lines.length || message.length > 800) return null;
  // Do not turn a request for a ride into a price offer.
  if (/[?؟]/u.test(message) || /(?:מחפש|צריך|דרוש|כמה|למחיר)/u.test(message)) return null;
  // An unfamiliar vehicle must never silently become a regular car.
  const smallSix = /6\s*מק(?:ומות)?['׳״]?\s*קטן/u.test(message);
  const small = smallSix || /(?:^|[^\p{L}\p{N}])(?:מיניק|מיני)(?=$|[^\p{L}\p{N}])/u.test(message);
  const roomy = /(?:^|[^\p{L}\p{N}])מרווח(?=$|[^\p{L}\p{N}])/u.test(message);
  const sienna = /(?:^|[^\p{L}\p{N}])(?:סיינה|סייאנה|סיאנה|7\s*מק(?:ומות)?)(?=$|[^\p{L}\p{N}])/u.test(message);
  if (/(?:^|[^\p{L}\p{N}])(?:מיניוואן|מיניבוס|סטיישן|אוטובוס)(?=$|[^\p{L}\p{N}])/u.test(message)
    || (/6\s*מק(?:ומות)?/u.test(message) && !small && !roomy)
    || Number(small) + Number(roomy) + Number(sienna) > 1) return null;
  const amounts = [...message.matchAll(/(?<![\d:/])(?:₪[ \t]*)?([1-9]\d{1,3})[ \t]*(?:₪|ש(?:["׳״']?ח)?|שקל(?:ים)?)?(?![\p{L}\d:/])/gu)]
    .filter((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // A date or a hyphenated phone number is not a fare.
      return Number(match[1]) >= 50 && Number(match[1]) <= 5000
        && !/\d\s*-\s*$/u.test(message.slice(0, start))
        && !/^\s*-\s*\d/u.test(message.slice(end));
    });
  if (amounts.length !== 1) return null;
  const amount = amounts[0];
  const price = Number(amount[1]);
  const priceLine = message.split(/\r?\n/u).find((line) => line.includes(amount[0])) ?? "";
  const known = new Set(knownPlaces.map(normalizeSearchText));
  const withoutAmount = (text: string) => text.replace(amount[0], " ");
  const [beforePrice, afterPrice] = priceLine.split(amount[0], 2);
  const beforeRoute = findMentionedRoute(beforePrice ?? "", known);
  const afterRoute = findMentionedRoute(afterPrice ?? "", known);
  if (beforeRoute && afterRoute && surgeDirectionKey(beforeRoute) !== surgeDirectionKey(afterRoute)) return null;
  const lineRoutes = lines.map((line) => findMentionedRoute(withoutAmount(line), known))
    .filter((route): route is { origin: string; destination: string } => route !== null);
  const priceRoute = beforeRoute ?? afterRoute ?? findMentionedRoute(withoutAmount(priceLine), known);
  const route = priceRoute ?? lineRoutes[0] ?? findMentionedRoute(withoutAmount(message), known);
  if (route && lineRoutes.some((candidate) =>
    surgeDirectionKey(candidate) !== surgeDirectionKey(route))) return null;
  const vehicleType = small ? "small_minivan" as const
    : roomy ? "roomy_six" as const : sienna ? "sienna" as const : "regular" as const;
  const extraPassenger = /(?:^|[^\p{L}\p{N}])מעל(?=$|[^\p{L}\p{N}])/u.test(message);
  return route
    ? { ...route, price, vehicleType, extraPassenger } : null;
}

export function parseSurgeQuotes(body: string, knownPlaces: readonly string[]) {
  if (body.length > 20_000) return [];
  // Distribution messages contain multiple numbered rides. Keep prices,
  // vehicle types and directions within each ride instead of mixing them.
  const headings = [...body.matchAll(/^[^\p{L}\p{N}\r\n]*נסיעה[ \t]+\d+[ \t]+מתוך[ \t]+\d+[^\r\n]*$/gmu)];
  if (!headings.length) {
    const quote = parseSurgeQuote(body, knownPlaces);
    return quote ? [quote] : [];
  }
  if (headings.length > 20) return [];
  return headings.flatMap((heading, index) => {
    const section = body.slice(heading.index, headings[index + 1]?.index ?? body.length);
    const quote = parseSurgeQuote(section, knownPlaces);
    return quote ? [quote] : [];
  });
}

export function matchSurgeProduct(
  route: { origin: string; destination: string },
  products: readonly Product[],
  abbreviations: readonly { shortcut: string; expansion: string }[],
) {
  const origin = expandCustomAbbreviations(route.origin, abbreviations);
  const destination = expandCustomAbbreviations(route.destination, abbreviations);
  if (normalizeSearchText(origin) === normalizeSearchText(destination)) return null;
  const variants = normalizedSearchVariants(`${origin} ⇔ ${destination}`);
  const matches = products.filter((product) => product.active && [product.name, ...product.aliases].some((candidate) =>
    normalizedSearchVariants(candidate).some((variant) => variants.includes(variant))));
  // No fuzzy matches or multi-stop substitutions. A quote for an ambiguous pair is ignored.
  return matches.length === 1 ? matches[0] : null;
}