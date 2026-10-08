import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateReferenceRoute, estimatedPriceMatrix, estimatedWaitTime, formatRouteEstimate, isIntraCityRoute, parseUnlistedRoute, primaryIntercityDistance, requiresManualCatalogPrice, resolveRouteAddresses } from "./route-estimate.ts";
import { expandCustomAbbreviations, isBuiltInAbbreviation, normalizedSearchVariants } from "./catalog-search.ts";
import { formatBillingCalculation, parseBillingAmount } from "./billing-calculator.ts";

test("parses two single-word destinations and explicitly separated multiword destinations", () => {
  assert.deepEqual(parseUnlistedRoute("רמות כותל"), { origin: "רמות", destination: "כותל" });
  assert.deepEqual(parseUnlistedRoute("פתח תקווה ⇔ תל אביב"), { origin: "פתח תקווה", destination: "תל אביב" });
  assert.equal(parseUnlistedRoute("פתח תקווה תל אביב"), null);
  assert.equal(parseUnlistedRoute("רמות"), null);
});

test("an existing Ramot–Western Wall route matches the short name rather than being estimated", () => {
  const existing = normalizedSearchVariants("רמות ⇔ הכותל המערבי");
  for (const query of ["רמות כותל", "כותל רמות", "רמות ⇔ כותל"]) {
    assert.ok(normalizedSearchVariants(query).some((variant) => existing.includes(variant)), query);
  }
});

test("existing Jerusalem–Givat Zeev price matches abbreviations and either direction", () => {
  const saved = normalizedSearchVariants("ירושלים ⇔ גבעת זאב / הר שמואל");
  assert.equal(normalizedSearchVariants("גבעז")[0], normalizedSearchVariants("גבעת זאב")[0]);
  for (const query of ["גבעז ים", "ים גבעז", "ירושלים ⇔ גבעז", "ים גבעת זאב", "הר שמואל ים"]) {
    assert.ok(normalizedSearchVariants(query).some((variant) => saved.includes(variant)), query);
  }
  for (const other of ["גבעת שמואל ים", "גבע בנימין ים"]) {
    assert.ok(!normalizedSearchVariants(other).some((variant) => saved.includes(variant)), other);
  }
});

test("matches the saved Jerusalem–Beitar Illit fare despite the misspelled custom shortcut", () => {
  const saved = normalizedSearchVariants("ביתר עילית ⇔ ירושלים");
  const abbreviations = [{ shortcut: "ביתר", expansion: "ביתר עלית" }];
  for (const query of ["ים ביתר", "ביתר ים", "ירושלים ביתר עלית", "ביתר עילית ירושלים"]) {
    assert.ok(normalizedSearchVariants(expandCustomAbbreviations(query, abbreviations))
      .some((variant) => saved.includes(variant)), query);
  }
  assert.equal(isBuiltInAbbreviation("ביתר"), true);
  assert.ok(!normalizedSearchVariants("ירושלים ביתרון").some((variant) => saved.includes(variant)));
});

test("custom shortcuts expand complete place names for either route direction without changing prices", () => {
  const abbreviations = [{ shortcut: "רג", expansion: "רמת גן" }];
  const saved = normalizedSearchVariants("אשדוד ⇔ רמת גן");
  for (const query of ["אשדוד רג", "רג אשדוד", "רג ⇔ אשדוד"]) {
    assert.ok(normalizedSearchVariants(expandCustomAbbreviations(query, abbreviations))
      .some((variant) => saved.includes(variant)), query);
  }
  assert.equal(expandCustomAbbreviations("רגע, רג!", abbreviations), "רגע, רמת גן!");
  assert.equal(isBuiltInAbbreviation("ים"), true);
  assert.equal(isBuiltInAbbreviation("רג"), false);
  assert.equal(expandCustomAbbreviations("רג", []), "רג");
});

test("splits missing routes using known place names without guessing another route", () => {
  const knownPlaces = ["בית שאן", "רכסים", "בית שמש", "תל אביב"];
  assert.deepEqual(parseUnlistedRoute("בית שאן רכסים", knownPlaces), {
    origin: "בית שאן",
    destination: "רכסים",
  });
  assert.deepEqual(parseUnlistedRoute("רכסים בית שאן", knownPlaces), {
    origin: "רכסים",
    destination: "בית שאן",
  });
  assert.equal(parseUnlistedRoute("בית שאן רכסים"), null);
  assert.deepEqual(parseUnlistedRoute("צפת כפר בלום", [...knownPlaces, "צפת"]), {
    origin: "צפת",
    destination: "כפר בלום",
  });
  assert.deepEqual(parseUnlistedRoute("כפר בלום צפת", [...knownPlaces, "צפת"]), {
    origin: "כפר בלום",
    destination: "צפת",
  });
  assert.deepEqual(parseUnlistedRoute("בית שאן מקום לא מוכר", knownPlaces), {
    origin: "בית שאן",
    destination: "מקום לא מוכר",
  });
  assert.deepEqual(parseUnlistedRoute("חצור הגלילית נוף הגליל", ["חצור", "נוף הגליל"]), {
    origin: "חצור הגלילית",
    destination: "נוף הגליל",
  });
  assert.deepEqual(parseUnlistedRoute("נוף הגליל חצור הגלילית", ["חצור", "נוף הגליל"]), {
    origin: "נוף הגליל",
    destination: "חצור הגלילית",
  });
  assert.equal(parseUnlistedRoute("בית שאן רחוב בני ברק", ["בית שאן", "בני ברק"]), null);
});

test("uses one map reference direction for both orders of an unlisted route", () => {
  const forward = estimateReferenceRoute("חצור הגלילית", "נוף הגליל");
  const reverse = estimateReferenceRoute("נוף הגליל", "חצור הגלילית");
  assert.deepEqual(forward, reverse);
  assert.notEqual(forward.origin, forward.destination);
  assert.deepEqual(
    estimateReferenceRoute("פתח תקווה", "תל אביב"),
    estimateReferenceRoute("תל אביב", "פתח תקווה"),
  );
  assert.match(
    formatRouteEstimate("נוף הגליל", "חצור הגלילית", 42, [170, 300, 230, 400, 270, 450, 290, 480]),
    /מרחק ייחוס.*המרחק בפועל עשוי להשתנות בכיוון השני/su,
  );
});

test("disambiguates Ramot near the Western Wall and rejects Ramot without city context", () => {
  assert.deepEqual(resolveRouteAddresses("רמות", "כותל"), {
    origin: "רמות, ירושלים",
    destination: "הכותל המערבי, ירושלים",
  });
  assert.equal(resolveRouteAddresses("רמות", "צפת"), null);
  assert.deepEqual(resolveRouteAddresses("רמות, גולן", "צפת"), {
    origin: "רמות, גולן",
    destination: "צפת",
  });
  assert.equal(resolveRouteAddresses("שדרות", "גת"), null);
  assert.deepEqual(resolveRouteAddresses("שדרות", "קרית גת"), { origin: "שדרות", destination: "קרית גת" });
});

test("does not quote a disputed catalog route in either direction until its price is restored", () => {
  const known = ["שדרות", "קרית גת"];
  const parsed = parseUnlistedRoute("שדרות גת", known);
  assert.deepEqual(parsed, { origin: "שדרות", destination: "גת" });
  assert.equal(requiresManualCatalogPrice(parsed.origin, parsed.destination), true);
  assert.equal(requiresManualCatalogPrice("קרית גת", "שדרות"), true);
  assert.equal(requiresManualCatalogPrice("שדרות", "קריית גת"), true);
  assert.equal(requiresManualCatalogPrice("שדרות", "עפולה"), false);
});

test("does not estimate missing trips within a city, but allows intercity trips", () => {
  assert.deepEqual(parseUnlistedRoute("פנימי ים"), { origin: "פנימי", destination: "ים" });
  assert.equal(isIntraCityRoute("פנימי", "ים"), true);
  assert.equal(isIntraCityRoute("ים", "פנימי"), true);
  assert.equal(isIntraCityRoute("פנימי", "ביתר"), true);
  assert.ok(normalizedSearchVariants("פנימי שמש").some((variant) => normalizedSearchVariants("פנימי בית שמש").includes(variant)));
  assert.equal(isIntraCityRoute("רמות", "תלפיות"), true);
  assert.equal(isIntraCityRoute("הרצל, חיפה", "הדר, חיפה"), true);
  assert.equal(isIntraCityRoute("חיפה", "הדר חיפה", ["חיפה", "רכסים"]), true);
  assert.equal(isIntraCityRoute("בית שאן", "רכסים", ["בית שאן", "רכסים"]), false);
});

test("uses Google's primary road route, not a shorter alternate, between verified different localities", () => {
  const locality = (placeId) => ({ type: ["locality", "political"], placeId });
  const geo = { origin: locality("Safed"), destination: locality("Kfar-Blum") };
  assert.deepEqual(primaryIntercityDistance({
    routes: [
      { distanceMeters: 59054, routeLabels: ["DEFAULT_ROUTE"] },
      { distanceMeters: 53465, routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] },
      { distanceMeters: 73288, routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] },
    ],
    geocodingResults: geo,
  }), { kind: "intercity", distanceKm: 59.054 });
  assert.deepEqual(primaryIntercityDistance({
    routes: [{ distanceMeters: 38000, routeLabels: ["DEFAULT_ROUTE"] }],
    geocodingResults: { origin: locality("Safed"), destination: { type: ["route"], placeId: "Safed-street" } },
  }), { kind: "not_intercity" });
  assert.deepEqual(primaryIntercityDistance({
    routes: [{ distanceMeters: 18000, routeLabels: ["DEFAULT_ROUTE"] }],
    geocodingResults: { origin: locality("Safed"), destination: locality("Safed") },
  }), { kind: "not_intercity" });
  assert.deepEqual(primaryIntercityDistance({ routes: [{ distanceMeters: 59054 }] }), { kind: "not_intercity" });
  assert.equal(primaryIntercityDistance({ routes: [], geocodingResults: geo }), null);
  assert.equal(primaryIntercityDistance({
    routes: [{ distanceMeters: 53465, routeLabels: ["DEFAULT_ROUTE_ALTERNATE"] }],
    geocodingResults: geo,
  }), null);
});

test("rounds 4 shekels per km to tens and derives all vehicle prices from the same catalog tier", () => {
  const prices = estimatedPriceMatrix(63, [
    { priceMatrix: [250, 400, 300, 500, 350, 600, 370, 650] },
    { priceMatrix: [250, 450, 320, 570, 380, 650, 400, 700] },
    { priceMatrix: [500, 1000, 700, 1200, 800, 1400, 900, 1600] },
    { priceMatrix: [250] },
  ]);
  assert.deepEqual(prices, [250, 430, 310, 540, 370, 630, 390, 680]);
  assert.equal(estimatedPriceMatrix(63.75, [{ priceMatrix: [250, 400, 300, 500, 350, 600, 370, 650] }])[0], 260);
  assert.match(formatRouteEstimate("בית שאן", "רכסים", 63, prices), /₪250/u);
  assert.match(formatRouteEstimate("בית שאן", "רכסים", 63, prices), /המסלול הראשי של Google Maps/u);
  assert.match(formatRouteEstimate("בית שאן", "רכסים", 63, prices), /אינו מדויק או מאושר/u);
});

test("includes the prevailing waiting allowance from the same price tier", () => {
  const comparisons = [
    { priceMatrix: [250, 450, 320, 570, 380, 650, 400, 690], waitTime: "עד שעה" },
    { priceMatrix: [250, 400, 300, 500, 350, 600, 370, 650], waitTime: "עד שעה" },
    { priceMatrix: [250, 400, 300, 500, 350, 600, 370, 650], waitTime: "עד 15 דקות" },
    { priceMatrix: [500, 800, 650, 1000, 700, 1050, 720, 1090], waitTime: "עד שעתיים" },
  ];
  assert.equal(estimatedWaitTime(250, comparisons), "עד שעה");
  assert.equal(estimatedWaitTime(270, comparisons), "עד שעה");
  assert.match(formatRouteEstimate("צפת", "כפר בלום", 37.5, [150, 280, 220, 400, 250, 450, 270, 490], "עד שעה"), /⏳ \*המתנה בצדדים -\* עד שעה/u);
  assert.equal(estimatedWaitTime(250, comparisons.slice(0, 1).concat(comparisons[2])), null);
  assert.match(formatRouteEstimate("צפת", "כפר בלום", 37.5, [150, 280, 220, 400, 250, 450, 270, 490]), /המתנה בצדדים -\* לא ניתן להעריך/u);
});

test("does not invent a larger vehicle price when no comparison exists", () => {
  assert.deepEqual(estimatedPriceMatrix(10, [{ priceMatrix: [40] }]), [40, 0, 0, 0, 0, 0, 0, 0]);
  assert.match(formatRouteEstimate("רמות", "כותל", 10, [40, 0, 0, 0, 0, 0, 0, 0]), /לא ניתן להעריך/u);
});

test("strawberry command calculates 12% and keeps the supplied message layout", () => {
  assert.equal(parseBillingAmount("מ 180🍓"), 180);
  assert.equal(parseBillingAmount("מ 180"), null);
  assert.equal(parseBillingAmount("מ 0🍓"), null);
  const message = formatBillingCalculation(120);
  assert.match(message, /🚉 \*דרייווער בוט - מחירון \+\* 🚉/u);
  assert.match(message, /מחיר הנסיעה:\* ₪120/u);
  assert.match(message, /החיוב על הנסיעה \(12%\):\* ₪14\.4/u);
  assert.match(message, /הרווח שלך:\* ₪105\.6/u);
  assert.doesNotMatch(message, /(?:wa\.me|whatsapp\.com|https?:\/\/)/iu);
});