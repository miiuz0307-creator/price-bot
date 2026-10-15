import assert from "node:assert/strict";
import test from "node:test";
import { normalizedSearchVariants } from "../src/services/catalog-search";

test('a numbered block name ("<route> - 1") is found by the plain route', () => {
  const name = normalizedSearchVariants("ירושלים ⇔ ים המלח - 1");
  const query = normalizedSearchVariants("ים המלח ירושלים");
  assert.ok(query.some((variant) => name.includes(variant)));
  // Numbers that are part of a place stay.
  assert.ok(normalizedSearchVariants("בית שמש ג 2")[0].endsWith("2"));
});

test("an abbreviation already written in full is not expanded twice", async () => {
  const { expandCustomAbbreviations } = await import("../src/services/catalog-search");
  const abbreviations = [{ shortcut: "אונו", expansion: "קרית אונו" }, { shortcut: "קאסם", expansion: "כפר קאסם" }];
  assert.equal(expandCustomAbbreviations("אלעד קרית אונו", abbreviations), "אלעד קרית אונו");
  assert.equal(expandCustomAbbreviations("אלעד אונו", abbreviations), "אלעד קרית אונו");
  assert.equal(expandCustomAbbreviations("ירושלים כפר קאסם", abbreviations), "ירושלים כפר קאסם");
  assert.equal(expandCustomAbbreviations("קאסם ירושלים", abbreviations), "כפר קאסם ירושלים");
});
