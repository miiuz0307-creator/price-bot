import { test } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppIngressTiming } from "./whatsapp-ingress-timing.ts";

test("separates raw socket arrival from decrypted handler arrival", () => {
  let now = 1_000;
  const timing = new WhatsAppIngressTiming(10, 10_000, () => now);
  timing.record("group", "query", false);
  now += 4_000;
  const trace = timing.consume("group", "query");
  assert.equal(now - trace.lastReceivedAt, 4_000);
  assert.equal(trace.deliveries, 1);
  assert.equal(timing.consume("group", "query"), undefined);
});

test("tracks retry recovery separately from the latest ingress wait", () => {
  let now = 1_000;
  const timing = new WhatsAppIngressTiming(10, 10_000, () => now);
  timing.record("group", "query", false);
  now += 2_000;
  timing.record("group", "query", true);
  now += 100;
  assert.deepEqual(timing.consume("group", "query"), {
    firstReceivedAt: 1_000, lastReceivedAt: 3_000, deliveries: 2, offline: true,
  });
});

test("same message ID in different chats has independent timing", () => {
  const timing = new WhatsAppIngressTiming();
  timing.record("one", "id", false);
  timing.record("two", "id", true);
  assert.equal(timing.consume("one", "id").offline, false);
  assert.equal(timing.consume("two", "id").offline, true);
});

test("bounded diagnostic traces evict old entries without affecting newer ones", () => {
  const timing = new WhatsAppIngressTiming(2);
  for (const id of ["a", "b", "c"]) timing.record("chat", id, false);
  assert.equal(timing.consume("chat", "a"), undefined);
  assert.equal(timing.consume("chat", "b").deliveries, 1);
  assert.equal(timing.consume("chat", "c").deliveries, 1);
});

test("expired traces cannot misattribute a later message to old socket backlog", () => {
  let now = 1_000;
  const timing = new WhatsAppIngressTiming(10, 100, () => now);
  timing.record("chat", "old", false);
  now += 101;
  assert.equal(timing.consume("chat", "old"), undefined);
  timing.record("chat", "old", false);
  assert.equal(timing.consume("chat", "old").firstReceivedAt, 1_101);
});