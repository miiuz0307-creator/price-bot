import assert from "node:assert/strict";
import test from "node:test";
import { proto } from "@whiskeysockets/baileys";
import { makeSafeCacheableSignalKeyStore } from "./whatsapp-key-cache.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeBacking(initial = {}) {
  const values = new Map();
  let getCalls = 0;
  let clearCalls = 0;
  const compoundKey = (type, id) => `${type}.${id}`;

  for (const [type, keys] of Object.entries(initial)) {
    for (const [id, value] of Object.entries(keys)) {
      values.set(compoundKey(type, id), value);
    }
  }

  const store = {
    async get(type, ids) {
      getCalls += 1;
      const result = {};
      for (const id of ids) {
        const key = compoundKey(type, id);
        if (values.has(key)) result[id] = values.get(key);
      }
      return result;
    },
    async set(data) {
      for (const [type, keys] of Object.entries(data)) {
        for (const [id, value] of Object.entries(keys ?? {})) {
          const key = compoundKey(type, id);
          if (value === null) values.delete(key);
          else values.set(key, value);
        }
      }
    },
    async clear() {
      clearCalls += 1;
      values.clear();
    },
  };

  return {
    store,
    read(type, id) {
      return values.get(compoundKey(type, id));
    },
    put(type, id, value) {
      values.set(compoundKey(type, id), value);
    },
    get getCalls() {
      return getCalls;
    },
    get clearCalls() {
      return clearCalls;
    },
  };
}

const testTimeoutMs = 5_000;

test("caches hot reads, fetches multiple IDs together, and exposes newly set keys", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking({
    session: { first: "persisted-first", second: "persisted-second" },
  });
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  assert.deepEqual(await keys.get("session", ["first", "second", "missing"]), {
    first: "persisted-first",
    second: "persisted-second",
  });
  assert.equal(backing.getCalls, 1);

  assert.deepEqual(await keys.get("session", ["first", "second", "missing"]), {
    first: "persisted-first",
    second: "persisted-second",
  });
  assert.equal(backing.getCalls, 1, "hot keys (and known-absent keys) are served from memory");

  await keys.set({ session: { missing: "newly-set" } });
  assert.deepEqual(await keys.get("session", ["missing"]), { missing: "newly-set" });
  await keys.flush();
  assert.equal(backing.read("session", "missing"), "newly-set");
});

test("writes return immediately, reach the disk in the background, and flush() waits for them", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking();
  const originalSet = backing.store.set;
  const finishBackingSet = deferred();
  backing.store.set = async (data) => {
    await finishBackingSet.promise;
    await originalSet(data);
  };
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  await keys.set({ session: { record: "value-1" } });
  await keys.set({ session: { record: "value-2" } });
  assert.deepEqual(await keys.get("session", ["record"]), { record: "value-2" }, "newest value is visible at once");
  assert.equal(backing.read("session", "record"), undefined, "disk not written yet");

  let flushed = false;
  const flushing = keys.flush().then(() => { flushed = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(flushed, false);
  finishBackingSet.resolve();
  await flushing;
  assert.equal(backing.read("session", "record"), "value-2");
});

test("a deletion hides the key at once and is never undone by a slower disk read", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking({ session: { record: "on-disk" } });
  const keys = makeSafeCacheableSignalKeyStore(backing.store);
  assert.deepEqual(await keys.get("session", ["record"]), { record: "on-disk" });
  await keys.set({ session: { record: null } });
  assert.deepEqual(await keys.get("session", ["record"]), {});
  await keys.flush();
  assert.equal(backing.read("session", "record"), undefined);
  assert.deepEqual(await keys.get("session", ["record"]), {});
});

test("a failed disk write is retried and newer writes win", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking();
  const originalSet = backing.store.set;
  let failures = 1;
  backing.store.set = async (data) => {
    if (failures-- > 0) throw new Error("disk busy");
    await originalSet(data);
  };
  const reports = [];
  const keys = makeSafeCacheableSignalKeyStore(backing.store, (report) => reports.push(report));
  await keys.set({ session: { record: "first" } });
  await keys.set({ session: { record: "second" } });
  await keys.flush();
  assert.equal(backing.read("session", "record"), "second");
  assert.ok(reports.some((report) => String(report.type).startsWith("failed")));
});

test("clear() only forgets memory and never clears persistent auth", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking();
  const keys = makeSafeCacheableSignalKeyStore(backing.store);
  await keys.set({ session: { retained: "still-on-disk" } });
  await keys.clear();
  assert.equal(backing.clearCalls, 0);
  assert.equal(backing.read("session", "retained"), "still-on-disk");
  assert.deepEqual(await keys.get("session", ["retained"]), { retained: "still-on-disk" });
});

test("a failed backing read does not poison subsequent cache operations", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking({ session: { record: "available-after-error" } });
  const originalGet = backing.store.get;
  const readError = new Error("backing read failed");
  let failOnce = true;
  backing.store.get = async (...args) => {
    if (failOnce) {
      failOnce = false;
      throw readError;
    }
    return originalGet(...args);
  };
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  await assert.rejects(
    keys.get("session", ["record"]),
    (error) => error === readError,
  );
  assert.deepEqual(await keys.get("session", ["record"]), {
    record: "available-after-error",
  });
});

test("preserves Baileys protobuf key prototypes instead of cloning key objects", { timeout: testTimeoutMs }, async () => {
  const protobufKey = proto.Message.AppStateSyncKeyData.fromObject({});
  const backing = makeBacking({
    "app-state-sync-key": { protobuf: protobufKey },
  });
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  const result = await keys.get("app-state-sync-key", ["protobuf"]);
  assert.equal(result.protobuf, protobufKey);
  assert.equal(
    Object.getPrototypeOf(result.protobuf),
    Object.getPrototypeOf(protobufKey),
  );
});