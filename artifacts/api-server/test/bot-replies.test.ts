/**
 * Golden-master test for the WhatsApp bot.
 *
 * Seeds a real PostgreSQL database with a small catalog, feeds ~50 realistic
 * WhatsApp messages through the exact handler the live bot uses, and compares
 * every reply with test/__snapshots__/bot-replies.json.
 *
 * - First run (no snapshot file) or UPDATE_SNAPSHOT=1: records the snapshot.
 * - Every later run: any difference in any reply fails the test.
 *
 * Requires DATABASE_URL pointing at an empty, schema-initialized database.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const snapshotPath = path.resolve(process.env.SNAPSHOT_DIR ?? "test/__snapshots__", "bot-replies.json");

type Incoming = { from: string; chatId: string; isGroup: boolean; body: string; isHistory?: boolean };
type Case = { name: string; message: Incoming; adminPhone?: string };

const OWNER_PHONE = "0504107826";
const SECOND_ADMIN_PHONE = "0521234567";
const CUSTOMER = "972501111111";
const STRANGER = "972509999999";
const GROUP = "120363000000000001";
const SURGE_GROUP = "120363000000000002";

const matrix = (base: number) => [base, base * 2 - 20, base + 30, base * 2 + 40, base + 50, base * 2 + 80, base + 70, base * 2 + 120];

const products = [
  { name: "בני ברק ⇔ ירושלים", price: "160", aliases: ["בב ים", "ירושלים בני ברק"], distance: "62 ק״מ", duration: "50 דק׳", level: "מחירון רגיל", priceMatrix: matrix(160), waitTime: "₪40 לשעה" },
  { name: "ירושלים ⇔ תל אביב", price: "250", aliases: ["ים תא"], distance: "65 ק״מ", duration: "1 שעה", level: "מחירון רגיל", priceMatrix: matrix(250), waitTime: "₪40 לשעה" },
  { name: "אופקים ⇔ באר שבע", price: "120", aliases: [], distance: "28 ק״מ", duration: "25 דק׳", level: "", priceMatrix: matrix(120), waitTime: "" },
  { name: "בני ברק ⇔ פתח תקווה", price: "70", aliases: ["בב פת"], distance: "8 ק״מ", duration: "15 דק׳", level: "", priceMatrix: matrix(70), waitTime: "₪30 לשעה" },
  { name: "בית שמש ⇔ ירושלים", price: "180", aliases: [], distance: "30 ק״מ", duration: "35 דק׳", level: "אושר על ידי מנהל", priceMatrix: matrix(180), waitTime: "" },
  { name: "אשדוד ⇔ אשקלון", price: "110", aliases: [], distance: "", duration: "", level: "", priceMatrix: [110], waitTime: "" },
  { name: "חיפה ⇔ עכו", price: "130", aliases: [], distance: "", duration: "", level: "", priceMatrix: matrix(130), waitTime: "", active: false },
  { name: "בני ברק ⇔ נתב\"ג", price: "130", aliases: ["בב שדה"], distance: "20 ק״מ", duration: "25 דק׳", level: "", priceMatrix: matrix(130), waitTime: "" },
];

const contact = (body: string, from = CUSTOMER): Incoming => ({ from, chatId: from, isGroup: false, body });
const group = (body: string, from = CUSTOMER, chatId = GROUP): Incoming => ({ from, chatId, isGroup: true, body });

const cases: Case[] = [
  // Catalog matches, both directions, abbreviations, aliases.
  { name: "exact route", message: contact("מ בני ברק ירושלים") },
  { name: "reverse direction", message: contact("מ ירושלים בני ברק") },
  { name: "built-in abbreviations", message: contact("מ בב ים") },
  { name: "with arrow", message: contact("מ בני ברק ⇔ ירושלים") },
  { name: "jerusalem neighborhoods block", message: contact("מ ירושלים תל אביב") },
  { name: "abbreviation alias", message: contact("מ ים תא") },
  { name: "approved-by-admin level", message: contact("מ בית שמש ירושלים") },
  { name: "single price product", message: contact("מ אשדוד אשקלון") },
  { name: "airport alias", message: contact("מ בב שדה") },
  { name: "fuzzy correction", message: contact("מ אופקים באר שבעע") },
  { name: "final letters & niqqud", message: contact("מ אופקים בְּאֵר שבע") },
  { name: "custom abbreviation expands", message: contact("מ בבפת") },
  { name: "custom abbreviation alone", message: contact("מ רג") },
  { name: "paused product", message: contact("מ חיפה עכו") },
  // Fixed texts.
  { name: "hourly pricing", message: contact("מ לפי שעה") },
  { name: "extras", message: contact("מ תוספות") },
  { name: "billing integer", message: contact("מ 150🍓") },
  { name: "billing decimal", message: contact("מ 99.5🍓") },
  { name: "billing comma", message: contact("מ 99,90🍓") },
  // Edge input.
  { name: "bare mem", message: contact("מ") },
  { name: "mem with spaces", message: contact("מ   ") },
  { name: "short query", message: contact("מ ים") },
  { name: "non-command private", message: contact("שלום") },
  { name: "unknown single word", message: contact("מ ירושלייםםםםםם") },
  // Unlisted routes (no Google key in tests → deterministic fallbacks).
  { name: "unlisted intercity", message: contact("מ רמת גן חולון") },
  { name: "unlisted intercity arrow", message: contact("מ דימונה ⇔ ערד") },
  { name: "intra-city jerusalem", message: contact("מ רמות גילה") },
  { name: "intra-city פנימי", message: contact("מ פנימי ים") },
  { name: "manual catalog route", message: contact("מ שדרות קרית גת") },
  { name: "ambiguous גת", message: contact("מ גת אשדוד") },
  // Permissions and targets.
  { name: "not a target", message: contact("מ בני ברק ירושלים", STRANGER) },
  { name: "management by admin", message: contact("ניהול", "972521234567") },
  { name: "management by customer", message: contact("ניהול") },
  { name: "management by workspace owner", message: contact("ניהול", "972504107826") },
  { name: "management by shared workspace member", message: contact("ניהול", "972531230000") },
  // Groups.
  { name: "group price request", message: group("מ בני ברק ירושלים") },
  { name: "group chatter ignored", message: group("מי נוסע מחר לירושלים?") },
  { name: "group mem without space ignored", message: group("מבני ברק ירושלים") },
  { name: "group not a target", message: group("מ בני ברק ירושלים", CUSTOMER, "120363999999999999") },
  { name: "history message ignored", message: { ...contact("מ בני ברק ירושלים"), isHistory: true } },
  // Second administrator: own header/credit, own targets.
  { name: "second admin header", message: contact("מ בני ברק ירושלים"), adminPhone: SECOND_ADMIN_PHONE },
  { name: "second admin hourly", message: contact("מ לפי שעה"), adminPhone: SECOND_ADMIN_PHONE },
  // Surge pricing: quotes captured from the monitored group, then shown on lookup.
  // Fixed: text identical to a two-city alias ("בב ים") used to be read as ONE place and ignored.
  { name: "surge quote alias form", message: group("בב ים 260", "972502222222", SURGE_GROUP) },
  { name: "surge quote regular", message: group("בני ברק ירושלים 260", "972502222222", SURGE_GROUP) },
  { name: "surge quote minivan reverse", message: group("ים בני ברק 300 מיניק", "972502222222", SURGE_GROUP) },
  { name: "surge quote extra passenger", message: group("בני ברק ירושלים 6 מקומות מרווח 290 מעל", "972502222222", SURGE_GROUP) },
  { name: "surge distribution message", message: group("נסיעה 1 מתוך 2\nבני ברק ירושלים 270\nנסיעה 2 מתוך 2\nירושלים תל אביב 330 סיינה", "972502222222", SURGE_GROUP) },
  { name: "surge quote below catalog ignored", message: group("בב פת 50", "972502222222", SURGE_GROUP) },
  { name: "surge question ignored", message: group("כמה בב ים?", "972502222222", SURGE_GROUP) },
  { name: "lookup shows surge (same direction)", message: contact("מ בני ברק ירושלים") },
  { name: "lookup reverse direction shows minivan surge", message: contact("מ ירושלים בני ברק") },
  { name: "lookup unaffected route", message: contact("מ ים תא") },
  { name: "fuzzy match never shows surge", message: contact("מ בני ברק ירושליים") },
];

function normalize(text: string) {
  // Clock times depend on when the test runs.
  return text.replace(/\b\d{1,2}:\d{2}\b/gu, "HH:MM");
}

test("bot replies match the recorded snapshot", { timeout: 120_000 }, async () => {
  const dbModule = await import("@workspace/db");
  const { db, pool } = dbModule;
  const t = dbModule as unknown as Record<string, any>;
  const { sql } = await import("drizzle-orm");

  // Load the bot exactly as the server does.
  const { whatsappWeb } = await import("../src/services/whatsapp-web");
  await import("../src/routes/price-bot");
  const init = (await import("../src/routes/price-bot") as Record<string, any>).priceBotReady;
  if (init) await init; else await new Promise((resolve) => setTimeout(resolve, 1500));

  await db.execute(sql`truncate price_bot_surge_offers, price_bot_surge_settings, price_bot_lookups, price_bot_targets, price_bot_abbreviations, price_bot_products restart identity cascade`);
  const [owner] = await db.select().from(t.priceBotAdmins).where(sql`phone = ${OWNER_PHONE}`);
  assert.ok(owner, "owner admin is created on startup");
  const [second] = await db.insert(t.priceBotAdmins).values({ phone: SECOND_ADMIN_PHONE, label: "יצחק", role: "admin" })
    .onConflictDoUpdate({ target: t.priceBotAdmins.phone, set: { label: "יצחק", active: true } }).returning();

  await db.insert(t.priceBotAdmins).values({ phone: "0531230000", label: "חבר צוות", role: "admin", whatsappOwnerId: owner.id })
    .onConflictDoUpdate({ target: t.priceBotAdmins.phone, set: { active: true, whatsappOwnerId: owner.id } });

  await db.insert(t.priceBotProducts).values(products.map((p) => ({ currency: "ILS", active: true, ...p })));
  await db.insert(t.priceBotAbbreviations).values([
    { shortcut: "רג", normalizedShortcut: "רג", expansion: "רמת גן" },
    { shortcut: "בבפת", normalizedShortcut: "בבפת", expansion: "בני ברק פתח תקווה" },
  ]);
  for (const adminId of [owner.id, second.id]) {
    await db.insert(t.priceBotTargets).values([
      { adminId, kind: "contact", identifier: CUSTOMER, label: "לקוח" },
      { adminId, kind: "contact", identifier: "972521234567", label: "מנהל" },
      { adminId, kind: "contact", identifier: "972504107826", label: "בעלים" },
      { adminId, kind: "contact", identifier: "972531230000", label: "חבר צוות" },
      { adminId, kind: "group", identifier: GROUP, label: "קבוצת לקוחות" },
    ]);
  }
  await db.insert(t.priceBotSurgeSettings).values({ adminId: owner.id, active: true, groupIdentifiers: [SURGE_GROUP], startedAt: new Date(Date.now() - 60_000) });

  const handler = (whatsappWeb as unknown as { messageHandler: (m: unknown) => Promise<unknown> }).messageHandler;
  assert.equal(typeof handler, "function", "price bot registers a WhatsApp message handler");

  const results: Record<string, unknown> = {};
  for (const item of cases) {
    const adminId = item.adminPhone ? second.id : owner.id;
    const reply = await handler({ adminId, sentAt: Date.now(), ...item.message }) as { responseText?: string; matched?: boolean; shouldReply?: boolean } | null;
    results[item.name] = reply === null ? null : { matched: reply.matched, shouldReply: reply.shouldReply, responseText: normalize(reply.responseText ?? "") };
  }

  const surgeRows = await db.execute(sql`select price, vehicle_type, extra_passenger, direction_key, quoted_route, expires_at > now() as live from price_bot_surge_offers order by id`);
  const lookupRows = await db.execute(sql`select "from", body, matched, estimate is not null as has_estimate from price_bot_lookups order by id`);
  const snapshot = {
    replies: results,
    surgeOffers: surgeRows.rows,
    lookups: lookupRows.rows,
  };

  if (!existsSync(snapshotPath) || process.env.UPDATE_SNAPSHOT === "1") {
    mkdirSync(path.dirname(snapshotPath), { recursive: true });
    writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Snapshot written: ${snapshotPath}`);
  } else {
    const expected = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const actual = JSON.parse(JSON.stringify(snapshot));
    for (const name of Object.keys(expected.replies)) {
      assert.deepEqual(actual.replies[name], expected.replies[name], `reply changed: ${name}`);
    }
    assert.deepEqual(Object.keys(actual.replies), Object.keys(expected.replies), "case list changed");
    assert.deepEqual(actual.surgeOffers, expected.surgeOffers, "captured surge offers changed");
    assert.deepEqual(actual.lookups, expected.lookups, "logged lookups changed");
  }

  await whatsappWeb.shutdown?.();
  await pool.end();
});
