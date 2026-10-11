// Screenshots of the mobile app (web build of the same React Native code) at phone size.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.APP_URL ?? "http://127.0.0.1:8081";
const out = path.resolve(process.env.OUT_DIR ?? "docs/screenshots/app");
mkdirSync(out, { recursive: true });
const problems = [];

const login = await fetch(`${base}/api/auth/pin`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-price-bot-client": "mobile" },
  body: JSON.stringify({ identifier: "0504107826", code: "2468" }),
}).then((response) => response.json());
if (!login.token) throw new Error(`login failed: ${JSON.stringify(login)}`);
const products = await fetch(`${base}/api/products`, { headers: { authorization: `Bearer ${login.token}` } }).then((response) => response.json());
const product = products.find((item) => item.name.startsWith("בני ברק")) ?? products[0];

const screens = [
  ["home", "/"],
  ["prices", "/prices"],
  ["route", `/product/${product.id}`],
  ["route-edit", `/product/edit?id=${product.id}`],
  ["requests", "/requests"],
  ["surge", "/surge"],
  ["more", "/more"],
  ["whatsapp", "/whatsapp"],
  ["targets", "/targets"],
  ["abbreviations", "/abbreviations"],
  ["users", "/users"],
  ["activity", "/activity"],
];

const browser = await chromium.launch();
for (const scheme of (process.env.SCHEMES ?? "dark,light").split(",")) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme, locale: "he-IL", timezoneId: "Asia/Jerusalem", deviceScaleFactor: 2 });
  const page = await context.newPage();
  page.on("pageerror", (error) => problems.push(`${scheme}: page error: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/favicon|401/.test(message.text())) problems.push(`${scheme}: console: ${message.text().slice(0, 300)}`); });

  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${scheme}-login.png` });

  await page.evaluate((token) => localStorage.setItem("pricebot.session", token), login.token);
  for (const [name, url] of screens) {
    await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) problems.push(`${scheme}: ${name} overflows horizontally by ${overflow}px`);
    await page.screenshot({ path: `${out}/${scheme}-${name}.png` });
  }
  await context.close();
}
await browser.close();
if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`::warning title=App screenshots::${problems.slice(0, 15).join(" | ").replace(/\n/g, " ")}`);
}
console.log(`App screenshots saved to ${out}`);
