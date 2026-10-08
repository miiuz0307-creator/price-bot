import assert from "node:assert/strict";
import test from "node:test";
import { parseSurgeQuote, parseSurgeQuotes, matchSurgeProduct, matchesSurgeDirection, surgeDirectionKey, surgeDisplayedPrice, formatSurgePrice, sortSurgeOffers, isSurgeAboveCatalog, surgeLifetimeMs, surgeEffectiveExpiry, isSurgeActiveAt } from "./surge-pricing.ts";
import { parseUnlistedRoute } from "./route-estimate.ts";

const places = ["בב", "ים", "בני ברק", "ירושלים", "אשדוד", "רמת גן", "רג"];
const products = [
  { id: 1, name: "בני ברק ⇔ ירושלים", aliases: [], active: true, price: "220", currency: "ILS" },
  { id: 2, name: "אשדוד ⇔ רמת גן", aliases: [], active: true, price: "180", currency: "ILS" },
  { id: 3, name: "בני ברק ⇔ אלעד ⇔ ירושלים", aliases: [], active: true, price: "300", currency: "ILS" },
];

test("accepts the supplied group message without interpreting chatter as vehicle information", () => {
  const offer = parseSurgeQuote("בב ים 250ש ללא פון\nדסלר זמן", places);
  assert.deepEqual(offer, { origin: "בב", destination: "ים", price: 250, vehicleType: "regular", extraPassenger: false });
  assert.equal(matchSurgeProduct(offer, products, [])?.id, 1);
});

test("separates numbered group rides into their own prices, directions and vehicle types", () => {
  const body = [
    "🔻🔻 *נסיעה 1 מתוך 2* 🔻🔻",
    "*13:00*",
    "*ים בב*",
    "*260ש*",
    "*מרכזית*",
    "> 🏢 דסלר | 👨‍💻 NATAN",
    "👇 *לחץ כאן לנסיעה 1* 👇",
    "wa.me/972500000000?text=ride-1",
    "*------------------------*",
    "🔻🔻 *נסיעה 2 מתוך 2* 🔻🔻",
    "*בב ים 400 ש*",
    "*סייאנה פיצי מעל*",
    "*קיבוץ גליות*",
    "👇 *לחץ כאן לנסיעה 2* 👇",
    "wa.me/972500000000?text=ride-2",
    "*------------------------*",
    "⛔ *המספר הזה רק מפרסם — מבקשים רק בקישור* 👆",
  ].join("\n");
  assert.equal(parseSurgeQuote(body, places), null);
  const quotes = parseSurgeQuotes(body, places);
  assert.deepEqual(quotes, [
    { origin: "ים", destination: "בב", price: 260, vehicleType: "regular", extraPassenger: false },
    { origin: "בב", destination: "ים", price: 400, vehicleType: "sienna", extraPassenger: true },
  ]);
  assert.equal(matchSurgeProduct(quotes[0], products, [])?.id, 1);
  assert.equal(matchSurgeProduct(quotes[1], products, [])?.id, 1);
  assert.notEqual(surgeDirectionKey(quotes[0]), surgeDirectionKey(quotes[1]));
  assert.deepEqual(parseSurgeQuotes("ים בב 260ש", places), [quotes[0]]);
  assert.deepEqual(parseSurgeQuotes(body.replace("*260ש*", "*260ש 270ש*"), places), [quotes[1]]);
});

test("distinguishes small minivan and one passenger above the limit in either position", () => {
  assert.deepEqual(parseSurgeQuote("בב ים מיניק מעל 250ש", places), {
    origin: "בב", destination: "ים", price: 250, vehicleType: "small_minivan", extraPassenger: true,
  });
  assert.deepEqual(parseSurgeQuote("בב ים 250ש מעל", places), {
    origin: "בב", destination: "ים", price: 250, vehicleType: "regular", extraPassenger: true,
  });
  assert.equal(surgeDisplayedPrice({ price: 250, extraPassenger: true }), 270);
  assert.equal(surgeDisplayedPrice({ price: 250, extraPassenger: false }), 250);
  assert.equal(formatSurgePrice({ price: 200, extraPassenger: true }), "₪220 מעל");
  assert.equal(formatSurgePrice({ price: 200, extraPassenger: false }), "₪200");
});

test("lists live offers from smallest vehicle to largest, with the extra-passenger offer after its regular fare", () => {
  const offers = [
    { vehicleType: "sienna", extraPassenger: false },
    { vehicleType: "small_minivan", extraPassenger: true },
    { vehicleType: "roomy_six", extraPassenger: false },
    { vehicleType: "regular", extraPassenger: true },
    { vehicleType: "small_minivan", extraPassenger: false },
    { vehicleType: "regular", extraPassenger: false },
  ];
  assert.deepEqual(sortSurgeOffers(offers).map(({ vehicleType, extraPassenger }) => [vehicleType, extraPassenger]), [
    ["regular", false],
    ["regular", true],
    ["small_minivan", false],
    ["small_minivan", true],
    ["roomy_six", false],
    ["sienna", false],
  ]);
  assert.equal(offers[0].vehicleType, "sienna");
});

test("accepts a bare amount and vehicle detail on the next line without changing the route", () => {
  const offer = parseSurgeQuote("ים בב 550\nמיניק רמות", places);
  assert.deepEqual(offer, {
    origin: "ים", destination: "בב", price: 550, vehicleType: "small_minivan", extraPassenger: false,
  });
  assert.equal(matchSurgeProduct(offer, products, [])?.id, 1);
});

test("reads a route and price above a long WhatsApp signature without treating links as questions or fares", () => {
  const message = [
    "אשדוד בב",
    "200",
    "הפרחים 12",
    "זמן",
    "*בקישור* ☚ wa.me/972500000000?text=ת+004947855+nr1stk",
    "💥הדרריבערס האחראיים💥",
    "> 🍓 *איפוס חשבון 01 לחודש* ☚ wa.me/972500000000?text=תשלום",
    `סדרן ${"\u200e".repeat(1200)}`,
    "*לשאלות בלבד!* ☚ wa.me/972500000000?text=צ+004947855",
  ].join("\n");
  const quote = parseSurgeQuote(message, ["אשדוד", "בני ברק"]);
  assert.deepEqual(quote, {
    origin: "אשדוד", destination: "בב", price: 200, vehicleType: "regular", extraPassenger: false,
  });
  const product = { id: 359, name: "בני ברק ⇔ אשדוד", aliases: [], active: true,
    price: "180", priceMatrix: [180, 340, 250, 450, 300, 550, 320, 590], currency: "ILS" };
  assert.equal(matchSurgeProduct(quote, [product], [])?.id, 359);
  assert.equal(isSurgeAboveCatalog(quote, product), true);
  assert.equal(parseSurgeQuote(`${message}\nכמה עולה?`, ["אשדוד", "בני ברק"]), null);
  assert.equal(parseSurgeQuote(`${message}\nמחיר נוסף 300`, ["אשדוד", "בני ברק"]), null);
});

test("recognizes all three named vehicle types rather than treating them as a regular car", () => {
  for (const [name, vehicleType] of [
    ["מיניק", "small_minivan"],
    ["6 מרווח", "roomy_six"],
    ["6 מק' מרווח", "roomy_six"],
    ["סייאנה", "sienna"],
    ["סיינה", "sienna"],
    ["7 מקומות", "sienna"],
  ]) {
    const quote = parseSurgeQuote(`ים בב 550\n${name}`, places);
    assert.equal(quote?.vehicleType, vehicleType, name);
    assert.equal(matchSurgeProduct(quote, products, [])?.id, 1);
  }
});

test("extracts one route and one price across varied wording and line order", () => {
  const examples = [
    "מיניק ₪550 ירושלים לבני ברק",
    "מחיר: 550\nבב ⇔ ים\nמיניק",
    "מבב לים, מיני ב-550",
    "אשדוד לרמת גן – 240 ש״ח",
    "מיניק: 550 ₪ בני ברק / ירושלים",
    "6 מק' קטן — ירושלים בני ברק 550",
    "ים בב 550 מיניק רמות",
  ];
  for (const body of examples) {
    const quote = parseSurgeQuote(body, places);
    assert.ok(quote, body);
    assert.equal(quote.price, body.includes("240") ? 240 : 550);
    assert.equal(matchSurgeProduct(quote, products, [])?.id, body.includes("אשדוד") ? 2 : 1);
  }
});

test("never shows a group quote below the current catalog price for that vehicle", () => {
  const catalog = { price: "220", priceMatrix: [220, 400, 300, 550, 440, 750, 500, 900] };
  assert.equal(isSurgeAboveCatalog({ price: 550, vehicleType: "small_minivan" }, catalog), true);
  assert.equal(isSurgeAboveCatalog({ price: 270, vehicleType: "small_minivan" }, catalog), false);
  assert.equal(isSurgeAboveCatalog({ price: 430, vehicleType: "roomy_six" }, catalog), false);
  assert.equal(isSurgeAboveCatalog({ price: 550, vehicleType: "roomy_six" }, catalog), true);
  assert.equal(isSurgeAboveCatalog({ price: 490, vehicleType: "sienna" }, catalog), false);
  assert.equal(isSurgeAboveCatalog({ price: 550, vehicleType: "sienna" }, catalog), true);
  assert.equal(isSurgeAboveCatalog({ price: 550, vehicleType: "sienna" }, { ...catalog, priceMatrix: [220, 400, 300, 550] }), false);
  assert.equal(isSurgeAboveCatalog({ price: 220, vehicleType: "regular" }, catalog), false);
  assert.equal(isSurgeAboveCatalog({ price: 250, vehicleType: "regular" }, { ...catalog, priceMatrix: [260, 450, 320] }), false);
});

test("surge quotes expire after ten minutes, including offers stored with the former thirty-minute expiry", () => {
  const observedAt = new Date("2026-09-29T00:00:00.000Z");
  const oldOffer = { observedAt, expiresAt: new Date("2026-09-29T00:30:00.000Z") };
  assert.equal(surgeLifetimeMs, 10 * 60_000);
  assert.equal(surgeEffectiveExpiry(oldOffer).toISOString(), "2026-09-29T00:10:00.000Z");
  assert.equal(isSurgeActiveAt(oldOffer, new Date("2026-09-29T00:09:59.999Z")), true);
  assert.equal(isSurgeActiveAt(oldOffer, new Date("2026-09-29T00:10:00.000Z")), false);
  const stoppedOffer = { observedAt, expiresAt: new Date("2026-09-29T00:03:00.000Z") };
  assert.equal(surgeEffectiveExpiry(stoppedOffer).toISOString(), "2026-09-29T00:03:00.000Z");
  assert.equal(isSurgeActiveAt(stoppedOffer, new Date("2026-09-29T00:03:00.000Z")), false);
});

test("rejects requests, phone numbers and unknown or ambiguous routes", () => {
  assert.equal(parseSurgeQuote("בב ים 250?", places), null);
  assert.equal(parseSurgeQuote("מחפש בב ים 250ש", places), null);
  assert.equal(parseSurgeQuote("בב ים 250", places)?.price, 250);
  assert.equal(parseSurgeQuote("בב ים 054", places), null);
  assert.equal(parseSurgeQuote("בב ים 250ש מיניק סייאנה", places), null);
  assert.equal(parseSurgeQuote("בב ים 250ש 6 מקומות", places), null);
  assert.equal(parseSurgeQuote("בב ים 250ש מיניבוס", places), null);
  assert.equal(parseSurgeQuote("בב ים 123456789ש", places), null);
  assert.equal(parseSurgeQuote("בב ים 250 או 300", places), null);
  assert.equal(parseSurgeQuote("בב ים אשדוד 550", places), null);
  assert.equal(parseSurgeQuote("בב ים 250\nאשדוד רמת גן 250", places), null);
  assert.equal(parseSurgeQuote("בב ים 250\nאשדוד רמת גן", places), null);
  assert.equal(parseSurgeQuote("בב ים 250 אשדוד רמת גן", places), null);
  assert.equal(parseSurgeQuote("בב ים 23:45", places), null);
  assert.equal(parseSurgeQuote("בב ים 2026-09-29", places), null);
  assert.equal(parseSurgeQuote("בב ים 050-123-4567", places), null);
  assert.equal(parseSurgeQuote("בב ים המלח 550", places), null);
  assert.equal(matchSurgeProduct({ origin: "בב", destination: "אשדוד" }, products, []), null);
  assert.equal(matchSurgeProduct({ origin: "בב", destination: "ים" }, [...products, { ...products[0], id: 4 }], []), null);
});

test("matches either direction and custom shortcuts only against a unique saved route", () => {
  const shortcuts = [{ shortcut: "רג", expansion: "רמת גן" }];
  assert.equal(matchSurgeProduct({ origin: "רג", destination: "אשדוד" }, products, shortcuts)?.id, 2);
  assert.equal(matchSurgeProduct({ origin: "אשדוד", destination: "רג" }, products, shortcuts)?.id, 2);
});

test("keeps catalog matching bidirectional but applies surge only to its quoted direction", () => {
  const catalog = { id: 359, name: "בני ברק ⇔ אשדוד", aliases: [], active: true,
    price: "180", priceMatrix: [180, 340, 250, 450, 300, 550, 320, 590], currency: "ILS" };
  const fromBneiBrak = parseSurgeQuote("בב אשדוד 250ש", ["בני ברק", "אשדוד"]);
  const fromAshdod = parseUnlistedRoute("אשדוד בב", ["בני ברק", "אשדוד"]);
  assert.ok(fromBneiBrak);
  assert.ok(fromAshdod);
  assert.equal(matchSurgeProduct(fromBneiBrak, [catalog], [])?.id, 359);
  assert.equal(matchSurgeProduct(fromAshdod, [catalog], [])?.id, 359);
  const offer = { directionKey: surgeDirectionKey(fromBneiBrak) };
  assert.equal(matchesSurgeDirection(offer, { origin: "בני ברק", destination: "אשדוד" }), true);
  assert.equal(matchesSurgeDirection(offer, fromAshdod), false);
  assert.equal(matchesSurgeDirection({ directionKey: "" }, fromBneiBrak), false);
  assert.equal(matchesSurgeDirection(offer, null), false);
  assert.equal(surgeDirectionKey({ origin: "רג", destination: "אשדוד" }, [{ shortcut: "רג", expansion: "רמת גן" }]),
    surgeDirectionKey({ origin: "רמת גן", destination: "אשדוד" }));
  assert.notEqual(surgeDirectionKey(fromBneiBrak), surgeDirectionKey(fromAshdod));
  assert.equal(parseSurgeQuote("בב אשדוד 250\nאשדוד בב", ["בני ברק", "אשדוד"]), null);
});

test("recognizes the common Beitar shortcut in a group quote", () => {
  const quote = parseSurgeQuote("ביתר ים 250ש", ["ביתר עילית", "ירושלים"]);
  assert.ok(quote);
  assert.equal(matchSurgeProduct(quote, [{
    id: 308, name: "ביתר עילית ⇔ ירושלים", aliases: [], active: true,
    price: "120", priceMatrix: [120, 220, 180, 340, 200, 380, 220, 420], currency: "ILS",
  }], [])?.id, 308);
});