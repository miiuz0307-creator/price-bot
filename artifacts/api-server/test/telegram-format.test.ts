import assert from "node:assert/strict";
import test from "node:test";
import { whatsappToTelegramHtml } from "../src/services/telegram";

test("WhatsApp formatting becomes Telegram HTML", () => {
  assert.equal(
    whatsappToTelegramHtml("🗺️ *בני ברק ⇔ תל אביב*\n🚗 *4 מק' -* ₪70 <ok> & `wa.me/x`"),
    "🗺️ <b>בני ברק ⇔ תל אביב</b>\n🚗 <b>4 מק' -</b> ₪70 &lt;ok&gt; &amp; <code>wa.me/x</code>",
  );
  assert.equal(whatsappToTelegramHtml("snake_case_word stays"), "snake_case_word stays");
});
