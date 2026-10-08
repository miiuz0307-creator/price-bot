type PriceRow = { priceMatrix: number[]; waitTime?: string };

import { normalizeSearchText } from "./catalog-search";

export function parseUnlistedRoute(query: string, knownPlaces: readonly string[] = []): { origin: string; destination: string } | null {
  const text = query.trim();
  const pieces = text.split(/\s*(?:⇔|↔|→|->|\s+-\s+)\s*/u).map((part) => part.trim());
  const words = text.split(/\s+/u);
  let parts = pieces.length === 2 ? pieces : words;
  if (pieces.length !== 2 && words.length > 2) {
    // Prefer a unique split of two known places. Otherwise use a single
    // longest complete known place and let Maps verify the other locality.
    // A short alias such as "חצור" must not block "חצור הגלילית נוף הגליל".
    const places = new Set(knownPlaces.map(normalizeSearchText));
    const splits = Array.from({ length: words.length - 1 }, (_, index) => [
      words.slice(0, index + 1).join(" "),
      words.slice(index + 1).join(" "),
    ]);
    const known = (place: string) => places.has(normalizeSearchText(place));
    const bothKnown = splits.filter(([origin, destination]) => known(origin) && known(destination));
    const oneKnown = splits.filter(([origin, destination]) => known(origin) !== known(destination));
    const knownWordCount = ([origin, destination]: string[]) =>
      (known(origin) ? origin : destination).split(/\s+/u).length;
    const longest = Math.max(0, ...oneKnown.map(knownWordCount));
    const bestOneKnown = oneKnown.filter((split) => knownWordCount(split) === longest);
    parts = bothKnown.length === 1 ? bothKnown[0]
      : bothKnown.length === 0 && bestOneKnown.length === 1 ? bestOneKnown[0] : [];
  }
  if (parts.length !== 2 || parts.some((part) => part.length < 2 || part.length > 100)) return null;
  return { origin: parts[0], destination: parts[1] };
}

const jerusalemNeighborhoods = new Set([
  "ירושלים", "רמות", "כותל", "הכותל", "כותל המערבי", "הכותל המערבי",
  "רמת שלמה", "הר נוף", "בית וגן", "קרית יובל", "בר אילן", "סנהדריה",
  "הר חוצבים", "קרית משה", "גבעת שאול", "מאה שערים", "גילה",
  "הכניסה לעיר", "פסגת זאב", "נווה יעקב", "ממילא", "קטמון",
  "עין כרם", "תלפיות", "הר הזיתים", "ארמון הנציב", "הר חומה", "ארנונה",
].map(normalizeSearchText));

export function isIntraCityRoute(origin: string, destination: string, knownPlaces: readonly string[] = []): boolean {
  // "פנימי ים" means an intra-city Jerusalem ride, not a trip between localities.
  // A saved exact catalog price is checked before this fallback.
  if (normalizeSearchText(origin) === normalizeSearchText("פנימי")
    || normalizeSearchText(destination) === normalizeSearchText("פנימי")) return true;
  if (normalizeSearchText(origin) === normalizeSearchText(destination)) return true;
  const inJerusalem = (place: string) =>
    place.includes("ירושלים") || jerusalemNeighborhoods.has(normalizeSearchText(place));
  if (inJerusalem(origin) && inJerusalem(destination)) return true;

  // Explicit shared city, e.g. "הרצל, חיפה ⇔ הדר, חיפה", needs no map estimate.
  const originCity = origin.includes(",") ? normalizeSearchText(origin.split(",").at(-1)!) : null;
  const destinationCity = destination.includes(",") ? normalizeSearchText(destination.split(",").at(-1)!) : null;
  if (originCity && destinationCity && originCity === destinationCity) return true;

  // A known destination followed by the same city, e.g. "חיפה ⇔ הדר חיפה".
  return knownPlaces.some((place) => {
    const city = place.trim();
    if (city.length < 3) return false;
    const within = (value: string) => value.trim() === city || value.trim().endsWith(` ${city}`) || value.trim().endsWith(`, ${city}`);
    return within(origin) && within(destination);
  });
}

export function resolveRouteAddresses(origin: string, destination: string): { origin: string; destination: string } | null {
  const westernWall = (place: string) => /^(?:ה?כותל(?: המערבי)?)$/u.test(place.trim());
  const inJerusalem = (place: string) => westernWall(place) || place.includes("ירושלים");
  const resolve = (place: string, other: string) => {
    if (westernWall(place)) return "הכותל המערבי, ירושלים";
    if (place.trim() === "רמות") return inJerusalem(other) ? "רמות, ירושלים" : null;
    // "גת" can mean Kiryat Gat or Kibbutz Gat; never let Maps choose for the user.
    if (place.trim() === "גת") return null;
    return place;
  };
  const resolvedOrigin = resolve(origin, destination);
  const resolvedDestination = resolve(destination, origin);
  return resolvedOrigin && resolvedDestination
    ? { origin: resolvedOrigin, destination: resolvedDestination }
    : null;
}

// Estimates use one stable direction for a pair so reversing an unlisted
// request does not change the quoted price or trigger a second route direction.
export function estimateReferenceRoute(origin: string, destination: string): { origin: string; destination: string } {
  const first = normalizeSearchText(origin);
  const second = normalizeSearchText(destination);
  return first.localeCompare(second, "he") <= 0
    ? { origin, destination }
    : { origin: destination, destination: origin };
}

export function requiresManualCatalogPrice(origin: string, destination: string): boolean {
  // The owner confirmed this route has a set price, but it is missing from the
  // imported catalog. Hold it for review instead of inventing a Maps estimate.
  const from = normalizeSearchText(origin);
  const to = normalizeSearchText(destination);
  const sderot = normalizeSearchText("שדרות");
  const gatNames = [normalizeSearchText("גת"), normalizeSearchText("קרית גת"), normalizeSearchText("קריית גת")];
  return (from === sderot && gatNames.includes(to)) || (to === sderot && gatNames.includes(from));
}

type RouteGeocoding = { geocoderStatus?: string; type?: string[]; placeId?: string };
type RouteResponse = {
  routes?: { distanceMeters?: number; routeLabels?: string[] }[];
  geocodingResults?: { origin?: RouteGeocoding; destination?: RouteGeocoding };
};
export type DrivingDistanceResult = { kind: "intercity"; distanceKm: number } | { kind: "not_intercity" };

export function primaryIntercityDistance(data: RouteResponse): DrivingDistanceResult | null {
  const origin = data.geocodingResults?.origin;
  const destination = data.geocodingResults?.destination;
  // Never estimate a street, neighborhood or unresolved location as a different city.
  if (!origin?.type?.includes("locality") || !destination?.type?.includes("locality")
    || !origin.placeId || !destination.placeId || origin.placeId === destination.placeId) {
    return { kind: "not_intercity" };
  }
  const meters = data.routes?.find((route) => route.routeLabels?.includes("DEFAULT_ROUTE"))?.distanceMeters;
  return typeof meters === "number" && Number.isFinite(meters) && meters > 0
    ? { kind: "intercity", distanceKm: meters / 1000 }
    : null;
}

export async function drivingDistanceKm(origin: string, destination: string): Promise<DrivingDistanceResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;
  const resolved = resolveRouteAddresses(origin, destination);
  if (!resolved) return null;
  const response = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    signal: AbortSignal.timeout(8000),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters,routes.routeLabels,geocodingResults",
    },
    body: JSON.stringify({
      origin: { address: `${resolved.origin}, Israel` },
      destination: { address: `${resolved.destination}, Israel` },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
      languageCode: "he",
      units: "METRIC",
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      error?: { status?: string; details?: { reason?: string }[] };
    } | null;
    const status = body?.error?.status?.match(/^[A-Z_]+$/u)?.[0];
    const reason = body?.error?.details?.map((detail) => detail.reason)
      .find((value) => value && /^[A-Z_]+$/u.test(value));
    throw new Error(`Google Routes request failed (${response.status}${status ? `; ${status}` : ""}${reason ? `; ${reason}` : ""})`);
  }
  const data = await response.json() as RouteResponse;
  return primaryIntercityDistance(data);
}

function comparableRows(base: number, products: PriceRow[]): PriceRow[] {
  const valid = products
    .filter((product) => product.priceMatrix.length === 8
      && product.priceMatrix.every((price) => Number.isFinite(price) && price > 0));
  const exactTier = valid.filter((row) => row.priceMatrix[0] === base);
  if (exactTier.length) return exactTier;
  const nearestDifference = Math.min(...valid.map((row) => Math.abs(row.priceMatrix[0] - base)));
  return valid.filter((row) => Math.abs(row.priceMatrix[0] - base) === nearestDifference);
}

export function estimatedPriceMatrix(km: number, products: PriceRow[]): number[] | null {
  if (!Number.isFinite(km) || km <= 0) return null;
  const roundToTen = (value: number) => Math.max(10, Math.round(value / 10 + 1e-10) * 10);
  const base = roundToTen(km * 4);
  if (base <= 0) return null;
  const comparisons = comparableRows(base, products);
  return Array.from({ length: 8 }, (_, index) => {
    if (index === 0) return base;
    const ratios = comparisons
      .map((row) => row.priceMatrix[index] / row.priceMatrix[0])
      .filter((ratio) => Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 4)
      .sort((a, b) => a - b);
    if (!ratios.length) return 0;
    const middle = Math.floor(ratios.length / 2);
    const median = ratios.length % 2 ? ratios[middle] : (ratios[middle - 1] + ratios[middle]) / 2;
    return roundToTen(base * median);
  });
}

export function estimatedWaitTime(basePrice: number, products: PriceRow[]): string | null {
  const counts = new Map<string, number>();
  for (const row of comparableRows(basePrice, products)) {
    const waitTime = row.waitTime?.trim();
    if (waitTime) counts.set(waitTime, (counts.get(waitTime) ?? 0) + 1);
  }
  const ranked = [...counts].sort((left, right) => right[1] - left[1]);
  return ranked[0] && ranked[0][1] > (ranked[1]?.[1] ?? 0) ? ranked[0][0] : null;
}

export function formatRouteEstimate(
  origin: string,
  destination: string,
  km: number,
  matrix: number[],
  waitTime: string | null = null,
): string {
  const price = (value: number) => `₪${value.toLocaleString("he-IL")}`;
  const lines = [
    "🧮 *הערכת מחיר בלבד — לא מחיר רשמי במחירון*",
    `🗺️ ${origin} ⇔ ${destination}`,
    `🛣️ מרחק ייחוס לפי המסלול הראשי של Google Maps: ${km.toLocaleString("he-IL", { maximumFractionDigits: 1 })} ק״מ (לכיוון אחד)`,
    "",
    `🚗 *4 מק' -* ${price(matrix[0])}`,
    `♾️ *צדדים (הלוך ושוב) -* ${matrix[1] ? price(matrix[1]) : "לא ניתן להעריך"}`,
    "",
    `🚙 *6 מק' קטן -* ${matrix[2] ? price(matrix[2]) : "לא ניתן להעריך"}`,
    `♾️ *צדדים (הלוך ושוב) -* ${matrix[3] ? price(matrix[3]) : "לא ניתן להעריך"}`,
    "",
    `🚐 *6 מק' מרווח -* ${matrix[4] ? price(matrix[4]) : "לא ניתן להעריך"}`,
    `♾️ *צדדים (הלוך ושוב) -* ${matrix[5] ? price(matrix[5]) : "לא ניתן להעריך"}`,
    "",
    `🚌 *7 מק' (סיינה) -* ${matrix[6] ? price(matrix[6]) : "לא ניתן להעריך"}`,
    `♾️ *צדדים (הלוך ושוב) -* ${matrix[7] ? price(matrix[7]) : "לא ניתן להעריך"}`,
    "",
    `⏳ *המתנה בצדדים -* ${waitTime ?? "לא ניתן להעריך"}`,
    "",
    "⚠️ המחיר אינו מדויק או מאושר: המחיר לשני כיווני הנסיעה מבוסס על אותו מרחק ייחוס ב־Google Maps; המרחק בפועל עשוי להשתנות בכיוון השני. מחיר רכב 4 מקומות חושב לפי ₪4 לק״מ ועוגל לעשרות שקלים; שאר המחירים נגזרו ממסלולים במחירון עם מחיר בסיס דומה ועוגלו גם הם. יש לאמת מחיר סופי מול מנהל.",
  ];
  return lines.join("\n");
}