// Reproduces "paste a price message" on the website and reports where the page scrolls.
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const out = path.resolve(process.env.OUT_DIR ?? "docs/screenshots");
const message = readFileSync(path.resolve("scripts/ci/sample-price-message.txt"), "utf8");
const browser = await chromium.launch();
const report = [];
for (const [device, viewport, mobile] of [["desktop", { width: 1440, height: 900 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: "he-IL" });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByTestId("button-login-pin").click();
  await page.getByTestId("input-login-identifier").fill("0504107826");
  await page.getByTestId("input-login-code").fill("2468");
  await page.getByTestId("button-login-submit").click();
  await page.waitForTimeout(1500);
  await page.goto(`${base}/products`, { waitUntil: "networkidle" });
  const y = () => page.evaluate(() => Math.round(window.scrollY));
  report.push(`${device}: start scrollY=${await y()}`);
  await page.getByTestId("button-paste-product").click();
  await page.waitForTimeout(400);
  const box = page.getByTestId("input-pasted-price-message");
  await box.focus();
  await page.evaluate((text) => navigator.clipboard ? null : null, message);
  await box.fill(message);
  await page.waitForTimeout(400);
  report.push(`${device}: after paste scrollY=${await y()} dialogScroll=${await page.evaluate(() => document.querySelector('[role="dialog"]')?.scrollTop)}`);
  await page.screenshot({ path: `${out}/probe-${device}-pasted.png` });
  await page.getByTestId("button-import-pasted-price").click();
  for (const wait of [300, 1000, 2500]) {
    await page.waitForTimeout(wait);
    report.push(`${device}: +${wait}ms after save scrollY=${await y()} docHeight=${await page.evaluate(() => document.documentElement.scrollHeight)} modalOpen=${await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))} bodyStyle=${await page.evaluate(() => document.body.getAttribute("style"))}`);
  }
  await page.screenshot({ path: `${out}/probe-${device}-saved.png` });
  await context.close();
}
await browser.close();
console.log(report.join("\n"));
console.log(`::warning title=Paste probe::${report.join(" | ")}`);
