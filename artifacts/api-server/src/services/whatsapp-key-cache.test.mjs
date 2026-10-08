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

test("caches hot reads, fetches multiple IDs together, and exposes newly set missing keys", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking({
    session: { first: "persisted-first", second: "persisted-second" },
  });
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  assert.deepEqual(await keys.get("session", ["first", "second", "missing"]), {
    first: "persisted-first",
    second: "persisted-second",
  });
  assert.equal(backing.getCalls, 1);

  assert.deepEqual(await keys.get("session", ["first", "second"]), {
    first: "persisted-first",
    second: "persisted-second",
  });
  assert.equal(backing.getCalls, 1, "hot keys should be served from Baileys' cache");

  await keys.set({ session: { missing: "newly-persisted" } });
  assert.deepEqual(await keys.get("session", ["missing"]), {
    missing: "newly-persisted",
  });
  assert.equal(backing.read("session", "missing"), "newly-persisted");
});

test("waits for durable writes and deletion/clear never clear persistent auth", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking();
  const originalSet = backing.store.set;
  const enteredBackingSet = deferred();
  const finishBackingSet = deferred();
  backing.store.set = async (data) => {
    enteredBackingSet.resolve();
    await finishBackingSet.promise;
    await originalSet(data);
  };
  const keys = makeSafeCacheableSignalKeyStore(backing.store);

  let writeResolved = false;
  const write = keys
    .set({ session: { record: "durable-value" } })
    .then(() => {
      writeResolved = true;
    });
  await enteredBackingSet.promise;
  assert.equal(writeResolved, false);
  assert.equal(backing.read("session", "record"), undefined);

  finishBackingSet.resolve();
  await write;
  assert.equal(writeResolved, true);
  assert.equal(backing.read("session", "record"), "durable-value");

  backing.store.set = originalSet;
  assert.deepEqual(await keys.get("session", ["record"]), {
    record: "durable-value",
  });
  await keys.set({ session: { record: null } });
  assert.equal(backing.read("session", "record"), undefined);
  assert.deepEqual(await keys.get("session", ["record"]), {});

  await keys.set({ session: { retained: "still-on-disk" } });
  await keys.get("session", ["retained"]);
  await keys.clear();
  assert.equal(backing.clearCalls, 0, "cache clearing must not call backing clear");
  assert.equal(backing.read("session", "retained"), "still-on-disk");
  assert.deepEqual(await keys.get("session", ["retained"]), {
    retained: "still-on-disk",
  });
});

test("serializes reads through failed partial writes and reloads backing values", { timeout: testTimeoutMs }, async () => {
  const backing = makeBacking({
    session: { first: "old-first", second: "old-second" },
  });
  const originalSet = backing.store.set;
  const enteredBackingSet = deferred();
  const releaseFailedWrite = deferred();
  const writeError = new Error("backing write failed");
  let failNextWrite = false;
  backing.store.set = async (data) => {
    if (!failNextWrite) {
      return originalSet(data);
    }
    backing.put("session", "first", data.session.first);
    enteredBackingSet.resolve();
    await releaseFailedWrite.promise;
    throw writeError;
  };
  const keys = makeSafeCacheableSignalKeyStore(backing.store);
  await keys.get("session", ["first", "second"]);

  failNextWrite = true;
  const write = keys.set({
    session: { first: "partial-disk-value", second: "uncommitted-value" },
  });
  await enteredBackingSet.promise;

  let readResolved = false;
  const read = keys.get("session", ["first", "second"]).then((result) => {
    readResolved = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(readResolved, false, "a read must wait behind the in-flight write");

  releaseFailedWrite.resolve();
  await assert.rejects(write, (error) => error === writeError);
  assert.deepEqual(await read, {
    first: "partial-disk-value",
    second: "old-second",
  });

  failNextWrite = false;
  await keys.set({ session: { third: "future-write" } });
  assert.equal(backing.read("session", "third"), "future-write");
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