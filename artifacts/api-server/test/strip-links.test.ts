import { test } from "node:test";
import assert from "node:assert/strict";
import { stripProductLinks, stripWhatsAppLinks } from "../src/lib/strip-links";

test("removes wa.me signature links and the empty line they leave", () => {
  assert.equal(
    stripWhatsAppLinks("המחיר משתנה לפי האיזור\n👇\nwa.me/message/XKO4GSBLHTUCG1"),
    "המחיר משתנה לפי האיזור\n👇",
  );
  assert.equal(stripWhatsAppLinks("להזמנות https://wa.me/message/XKO4GSBLHTUCG1"), "להזמנות");
  assert.equal(stripWhatsAppLinks("wa.me/message/XKO4GSBLHTUCG1"), "");
  assert.equal(stripWhatsAppLinks("בלי קישור"), "בלי קישור");
});

test("cleans every product text field, aliases and sections", () => {
  const clean = stripProductLinks({
    name: "בני ברק ⇔ תל אביב", notes: "הערה\nwa.me/message/X", aliases: ["בב תא", "wa.me/message/X"],
    sections: [{ title: "רמת החייל", subtitle: "wa.me/message/X", priceMatrix: [70] }],
  });
  assert.equal(clean.notes, "הערה");
  assert.deepEqual(clean.aliases, ["בב תא"]);
  assert.equal(clean.sections?.[0].subtitle, "");
  assert.equal(clean.name, "בני ברק ⇔ תל אביב");
});
