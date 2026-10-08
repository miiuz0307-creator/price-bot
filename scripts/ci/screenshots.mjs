// Visual check: signs in through the real UI and screenshots every screen
// (desktop + phone, light + dark). Run by CI with the server on BASE_URL.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const out = path.resolve(process.env.OUT_DIR ?? "docs/screenshots");
mkdirSync(out, { recursive: true });

const pages = [
  ["dashboard", "/"],
  ["products", "/products"],
  ["abbreviations", "/abbreviations"],
  ["surge", "/surge"],
  ["targets", "/targets"],
  ["users", "/admins"],
  ["activity", "/activity"],
  ["settings", "/settings"],
];
const viewports = [
  ["desktop", { width: 1440, height: 900 }, false],
  ["phone", { width: 390, height: 844 }, true],
];
const schemes = (process.env.SCHEMES ?? "light").split(",");

const browser = await chromium.launch();
const problems = [];
for (const scheme of schemes) {
  for (const [device, viewport, mobile] of viewports) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme, locale: "he-IL", timezoneId: "Asia/Jerusalem", deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(`${device}/${scheme}: page error: ${error.message}`));
    page.on("console", (message) => { if (message.type() === "error") problems.push(`${device}/${scheme}: console: ${message.text()}`); });

    await page.goto(base, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${out}/${scheme}-${device}-login.png`, fullPage: false });
    await page.getByTestId("button-login-pin").click();
    await page.getByTestId("input-login-identifier").fill("0504107826");
    await page.getByTestId("input-login-code").fill("2468");
    await page.getByTestId("button-login-submit").click();
    await page.waitForSelector("main >> text=חדר הבקרה", { timeout: 15_000 }).catch(() => problems.push(`${device}/${scheme}: dashboard did not load after login`));

    for (const [name, url] of pages) {
      await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      // Horizontal scrolling on a phone is a layout bug.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 2) problems.push(`${device}/${scheme}: ${name} overflows horizontally by ${overflow}px`);
      await page.screenshot({ path: `${out}/${scheme}-${device}-${name}.png`, fullPage: true });
    }
    await context.close();
  }
}
await browser.close();
if (problems.length) {
  console.log(`::warning title=UI problems::${problems.join("%0A")}`);
}
console.log(`Saved screenshots to ${out}`);
