/** A route with several price blocks (e.g. neighborhoods) and notes, as pasted by a manager. */
import assert from "node:assert/strict";
import test from "node:test";
import { formatProductResponse } from "../src/bot/replies";

test("bot reply prints subtitle, extra price blocks and notes", () => {
  const product = {
    id: 1, name: "בני ברק ⇔ תל אביב", price: "70", currency: "ILS", aliases: [],
    distance: "4 ק״מ", duration: "15 דקות", level: "גבוה 🥇",
    priceMatrix: [70, 140, 100, 200, 120, 220, 140, 260], waitTime: "עד 30 דקות", active: true, updatedAt: new Date(),
    subtitle: "רמת החייל",
    notes: "המחיר משתנה לפי האיזור",
    sections: [{
      title: "בני ברק ⇔ תל אביב - 2", subtitle: "שכונות רגילות", distance: "6 ק״מ", duration: "21 דקות", level: "גבוה 🥇",
      priceMatrix: [100, 200, 150, 280, 180, 340, 200, 380], waitTime: "עד 40 דקות",
    }],
  };
  const text = formatProductResponse(product as never, "HEADER", "CREDIT");
  assert.match(text, /🗺️ \*בני ברק ⇔ תל אביב\*\n\*רמת החייל\*\n/);
  assert.match(text, /🚗 \*4 מק' -\* ₪70\n♾️ \*צדדים -\* ₪140/);
  assert.match(text, /-{10,}\n\n🗺️ \*בני ברק ⇔ תל אביב - 2\*\n\*שכונות רגילות\*/);
  assert.match(text, /🚌 \*7 מק' \(סיינה\)-\* ₪200\n♾️ \*צדדים -\* ₪380/);
  assert.match(text, /⏳ \*המתנה בצדדים -\* עד 40 דקות\n\n📝 \*הערות -\* המחיר משתנה לפי האיזור\n\nCREDIT$/);

  // Products without the new fields print exactly as before.
  const plain = formatProductResponse({ ...product, subtitle: "", notes: "", sections: [] } as never, "HEADER", "CREDIT");
  assert.doesNotMatch(plain, /הערות|רמת החייל|- 2/);
});
