// Golden test: replays a fixed set of WhatsApp messages through the real bot
// engine against a real (empty, test-only) PostgreSQL database and compares every
// reply with the recorded answers in golden/bot-replies.json.
//
// Purpose: refactors and new features must not change what customers receive.
// If a reply changes on purpose, regenerate with UPDATE_GOLDEN=1 and review the diff.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { sql } from "drizzle-orm";
import {
  db, pool, priceBotAbbreviations, priceBotAdmins, priceBotProducts, priceBotTargets,
} from "@workspace/db";
import { processPriceBotMessage } from "../routes/price-bot";

const goldenPath = path.resolve(process.cwd(), "src/tests/golden/bot-replies.json");

const CONTACT = "972501112222";
const STRANGER = "972509998888";
const ADMIN_PHONE = "972500000001";
const GROUP = "120363000000000001";
const OTHER_GROUP = "120363000000000002";

const matrix = (base: number) => [base, base * 2 - 20, base + 30, base * 2 + 40, base + 50, base * 2 + 80, base + 80, base * 2 + 140];

async function seed() {
  await db.execute(sql`truncate table price_bot_surge_offers, price_bot_surge_settings, price_bot_lookups, price_bot_targets, price_bot_abbreviations, price_bot_products, price_bot_admins restart identity cascade`);
  const [michael] = await db.insert(priceBotAdmins).values({ phone: ADMIN_PHONE, label: "מיכאל", role: "owner" }).returning();
  const [yitzhak] = await db.insert(priceBotAdmins).values({ phone: "972500000002", label: "יצחק", role: "admin" }).returning();
  for (const admin of [michael, yitzhak]) {
    await db.insert(priceBotTargets).values([
      { adminId: admin.id, kind: "contact", identifier: CONTACT, label: "לקוח" },
      { adminId: admin.id, kind: "contact", identifier: ADMIN_PHONE, label: "מנהל" },
      { adminId: admin.id, kind: "contact", identifier: STRANGER, label: "מושהה", active: false },
      { adminId: admin.id, kind: "group", identifier: GROUP, label: "קבוצת נהגים" },
    ]);
  }
  const base = { currency: "ILS", active: true } as const;
  await db.insert(priceBotProducts).values([
    { ...base, name: "בני ברק ⇔ ירושלים", price: "160", aliases: ["בב ים"], priceMatrix: matrix(160), distance: "60 ק״מ", duration: "50 דקות", level: "מחירון רגיל", waitTime: "₪30 לשעה" },
    { ...base, name: "ירושלים ⇔ בית שמש", price: "200", aliases: [], priceMatrix: matrix(200), distance: "30 ק״מ", duration: "35 דקות", level: "מחירון רגיל", waitTime: "20 דקות חינם" },
    { ...base, name: "תל אביב ⇔ חיפה", price: "400", aliases: ["תא חיפה"], priceMatrix: matrix(400), distance: "95 ק״מ", duration: "1:10 שעות", level: "בין עירוני", waitTime: "₪50 לשעה" },
    { ...base, name: "פתח תקווה ⇔ תל אביב", price: "100", aliases: [], priceMatrix: [100] },
    { ...base, name: "אשדוד ⇔ אשקלון", price: "120", aliases: [], priceMatrix: matrix(120), active: false },
    { ...base, name: "רמות ⇔ הכותל המערבי", price: "70", aliases: [], priceMatrix: matrix(70), level: "פנימי" },
    { ...base, name: "בני ברק ⇔ רמת גן", price: "50", aliases: [], priceMatrix: matrix(50) },
    { ...base, name: "בני ברק ⇔ רמת השרון", price: "90", aliases: [], priceMatrix: matrix(90) },
  ]);
  await db.insert(priceBotAbbreviations).values([
    { shortcut: "רג", normalizedShortcut: "רג", expansion: "רמת גן" },
  ]);
  return { michael, yitzhak };
}

type Case = { name: string; admin: "michael" | "yitzhak"; from: string; chatId?: string; isGroup?: boolean; body: string };

const cases: Case[] = [
  { name: "exact route", admin: "michael", from: CONTACT, body: "מ בני ברק ירושלים" },
  { name: "reversed route", admin: "michael", from: CONTACT, body: "מ ירושלים בני ברק" },
  { name: "built-in abbreviations", admin: "michael", from: CONTACT, body: "מ בב ים" },
  { name: "explicit separator", admin: "michael", from: CONTACT, body: "מ בני ברק ⇔ ירושלים" },
  { name: "typo correction", admin: "michael", from: CONTACT, body: "מ בני ברקק ירושלים" },
  { name: "jerusalem neighborhoods section", admin: "michael", from: CONTACT, body: "מ ירושלים בית שמש" },
  { name: "alias", admin: "michael", from: CONTACT, body: "מ תא חיפה" },
  { name: "single-price product", admin: "michael", from: CONTACT, body: "מ פתח תקווה תל אביב" },
  { name: "inactive product", admin: "michael", from: CONTACT, body: "מ אשדוד אשקלון" },
  { name: "ramot western wall", admin: "michael", from: CONTACT, body: "מ רמות כותל" },
  { name: "custom abbreviation route", admin: "michael", from: CONTACT, body: "מ בני ברק רג" },
  { name: "custom abbreviation alone", admin: "michael", from: CONTACT, body: "מ רג" },
  { name: "ambiguous prefix", admin: "michael", from: CONTACT, body: "מ בני ברק רמת" },
  { name: "short query", admin: "michael", from: CONTACT, body: "מ חיפה" },
  { name: "hourly pricing", admin: "michael", from: CONTACT, body: "מ לפי שעה" },
  { name: "extras", admin: "michael", from: CONTACT, body: "מ תוספות" },
  { name: "billing calculator", admin: "michael", from: CONTACT, body: "מ 150🍓" },
  { name: "billing calculator decimals", admin: "michael", from: CONTACT, body: "מ 99.5🍓" },
  { name: "empty query", admin: "michael", from: CONTACT, body: "מ" },
  { name: "not a price request", admin: "michael", from: CONTACT, body: "שלום" },
  { name: "management command from admin", admin: "michael", from: ADMIN_PHONE, body: "ניהול" },
  { name: "management command from customer", admin: "michael", from: CONTACT, body: "ניהול" },
  { name: "intra-city jerusalem", admin: "michael", from: CONTACT, body: "מ פנימי ים" },
  { name: "manual catalog route", admin: "michael", from: CONTACT, body: "מ שדרות קרית גת" },
  { name: "ambiguous place name", admin: "michael", from: CONTACT, body: "מ גת ⇔ באר שבע" },
  { name: "unlisted route without maps key", admin: "michael", from: CONTACT, body: "מ באר שבע ⇔ אילת" },
  { name: "unlisted without separator", admin: "michael", from: CONTACT, body: "מ קריית שמונה צפת עילית" },
  { name: "non-target sender", admin: "michael", from: "972507777777", body: "מ בני ברק ירושלים" },
  { name: "paused target", admin: "michael", from: STRANGER, body: "מ בני ברק ירושלים" },
  { name: "group price request", admin: "michael", from: CONTACT, chatId: GROUP, isGroup: true, body: "מ תל אביב חיפה" },
  { name: "group chatter ignored", admin: "michael", from: CONTACT, chatId: GROUP, isGroup: true, body: "מישהו יודע מה המחיר?" },
  { name: "group not a target", admin: "michael", from: CONTACT, chatId: OTHER_GROUP, isGroup: true, body: "מ תל אביב חיפה" },
  { name: "second admin header and credit", admin: "yitzhak", from: CONTACT, body: "מ בני ברק ירושלים" },
  { name: "second admin hourly", admin: "yitzhak", from: CONTACT, body: "מ לפי שעה" },
];

test("bot replies match the recorded golden answers", async () => {
  delete process.env.GOOGLE_MAPS_API_KEY; // deterministic: never call Google in tests
  await sleep(1500); // let the module's startup task (owner row, currency repair) finish first
  const admins = await seed();
  const results: { name: string; input: string; result: Awaited<ReturnType<typeof processPriceBotMessage>> }[] = [];
  for (const testCase of cases) {
    const result = await processPriceBotMessage({
      adminId: admins[testCase.admin].id,
      from: testCase.from,
      chatId: testCase.chatId ?? testCase.from,
      isGroup: testCase.isGroup ?? false,
      body: testCase.body,
      notifyAdmins: false,
    });
    results.push({ name: testCase.name, input: testCase.body, result });
  }

  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(goldenPath)) {
    mkdirSync(path.dirname(goldenPath), { recursive: true });
    writeFileSync(goldenPath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`Recorded ${results.length} golden replies to ${goldenPath}`);
    return;
  }
  const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as typeof results;
  for (const [index, expected] of golden.entries()) {
    assert.deepEqual(results[index], expected, `Reply changed for case "${expected.name}"`);
  }
  assert.equal(results.length, golden.length, "Number of cases changed");
});

after(async () => {
  await pool.end().catch(() => undefined);
  // The bot module keeps WhatsApp/reconnect timers alive; tests are done.
  setTimeout(() => process.exit(process.exitCode ?? 0), 200).unref();
});
