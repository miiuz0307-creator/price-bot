import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import { createContext, SourceTextModule, SyntheticModule } from "node:vm";
import * as nodeCrypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const testDirectory = dirname(fileURLToPath(import.meta.url));
const baileysLibDirectory = dirname(require.resolve("@whiskeysockets/baileys"));
const modulePath = resolve(baileysLibDirectory, "Socket/messages-recv.js");
const workspaceRoot = resolve(testDirectory, "../../../..");
const packagePatchPath = resolve(
  workspaceRoot,
  "patches/@whiskeysockets__baileys@7.0.0-rc14.patch",
);
const { decodeMessageNode: actualDecodeMessageNode, extractAddressingContext: actualExtractAddressingContext } =
  await import(pathToFileURL(resolve(baileysLibDirectory, "Utils/decode-wa-message.js")).href);
const { buildAckStanza: actualBuildAckStanza } =
  await import(pathToFileURL(resolve(baileysLibDirectory, "Utils/stanza-ack.js")).href);
const ME_PN = "15551234567:12@s.whatsapp.net";
const ME_LID = "987654321:12@lid";
const retryDelayMs = 14;

function makeMutex() {
  let tail = Promise.resolve();
  return {
    mutex(task) {
      const current = tail.then(task);
      tail = current.catch(() => {});
      return current;
    },
  };
}

class MockNodeCache {
  values = new Map();
  get(key) {
    return this.values.get(key);
  }
  set(key, value) {
    this.values.set(key, value);
  }
  del(key) {
    this.values.delete(key);
  }
  close() {}
}

function makeEmitter() {
  const listeners = new Map();
  return {
    on(name, callback) {
      const callbacks = listeners.get(name) ?? [];
      callbacks.push(callback);
      listeners.set(name, callbacks);
    },
    emit(name, value) {
      for (const callback of listeners.get(name) ?? []) {
        void callback(value);
      }
    },
    buffer() {},
    flush() {},
    async dispatch(name, value) {
      return Promise.all((listeners.get(name) ?? []).map(callback => callback(value)));
    },
  };
}

function makeHarness({
  open = true,
  retrySendErrors = [],
  ackErrors = [],
  closeDuringRetrySend = [],
  delaySessionReset = false,
} = {}) {
  const logs = [];
  const upserts = [];
  const retryAttempts = [];
  const retryDecodeInputs = [];
  const ackAttempts = [];
  const nackAttempts = [];
  const receipts = [];
  const retryCounts = new Map();
  const sessionIds = new Set();
  const retrySendErrorIds = new Set(retrySendErrors);
  const ackErrorIds = new Set(ackErrors);
  const closeDuringRetrySendIds = new Set(closeDuringRetrySend);
  const ws = makeEmitter();
  let socketOpen = open;
  Object.defineProperty(ws, "isOpen", {
    get() {
      return socketOpen;
    },
  });
  const setSocketOpen = value => {
    socketOpen = value;
  };
  const ev = makeEmitter();
  let authTransactionDepth = 0;
  let maxAuthTransactionDepth = 0;
  const authTransactionTails = new Map();
  let authSessionResetCount = 0;
  let releaseSessionReset;
  const sessionResetGate = new Promise(resolve => {
    releaseSessionReset = resolve;
  });
  const authState = {
    creds: {
      me: { id: ME_PN, lid: ME_LID },
      account: {},
      signedPreKey: {},
      signedIdentityKey: { public: Buffer.alloc(1) },
      registrationId: 1,
    },
    keys: {
      async get() {
        return {};
      },
      async set(updates) {
        for (const [id, value] of Object.entries(updates.session ?? {})) {
          if (value === null) {
            authSessionResetCount++;
            if (delaySessionReset) {
              await sessionResetGate;
            }
            sessionIds.delete(id);
          } else {
            sessionIds.add(id);
          }
        }
      },
      transaction(task, key = "default") {
        const previous = authTransactionTails.get(key) ?? Promise.resolve();
        const current = previous.then(async () => {
          authTransactionDepth++;
          maxAuthTransactionDepth = Math.max(maxAuthTransactionDepth, authTransactionDepth);
          try {
            return await task();
          } finally {
            authTransactionDepth--;
          }
        });
        authTransactionTails.set(key, current.catch(() => {}));
        return current;
      },
    },
  };
  const messageRetryManager = {
    hasExceededMaxRetries: () => false,
    incrementRetryCount(id) {
      const count = (retryCounts.get(id) ?? 0) + 1;
      retryCounts.set(id, count);
      return count;
    },
    shouldRecreateSession: (_jid, hasSession) => ({
      recreate: !hasSession,
      reason: "mock session absent",
    }),
    schedulePhoneRequest() {},
    addRecentMessage() {},
    cancelPendingPhoneRequest() {},
  };
  const sendNode = async stanza => {
    const id = stanza.attrs?.id;
    if (stanza.tag === "receipt" && stanza.attrs?.type === "retry") {
      retryAttempts.push({ id, at: performance.now(), stanza });
      if (closeDuringRetrySendIds.has(id)) {
        socketOpen = false;
      }
      if (retrySendErrorIds.has(id)) {
        throw new Error(`mock retry-send failure for ${id}`);
      }
    } else if (stanza.tag === "ack") {
      const attempt = { id, error: stanza.attrs?.error, stanza };
      ackAttempts.push(attempt);
      if (stanza.attrs?.error !== undefined) {
        nackAttempts.push(attempt);
      }
      if (ackErrorIds.has(id)) {
        throw new Error(`mock ack failure for ${id}`);
      }
    }
  };
  const messageMutex = makeMutex();
  const signalRepository = {
    lidMapping: {
      getLIDForPN: async () => undefined,
      getPNForLID: async () => undefined,
      storeLIDPNMappings: async () => {},
    },
    migrateSession: async () => {},
    validateSession: async jid => ({ exists: sessionIds.has(jid) }),
    jidToSignalProtocolAddress: jid => jid,
  };
  const sock = {
    userDevicesCache: new MockNodeCache(),
    devicesMutex: makeMutex(),
    ev,
    authState,
    ws,
    messageMutex,
    notificationMutex: makeMutex(),
    receiptMutex: makeMutex(),
    signalRepository,
    query: async () => ({}),
    upsertMessage: async (message, type) => {
      upserts.push({ id: message.key.id, type, message, at: performance.now() });
    },
    resyncAppState: async () => {},
    onUnexpectedError: error => logs.push({ level: "unexpected", error }),
    assertSessions: async () => {},
    sendNode,
    relayMessage: async () => {},
    sendReceipt: async (...args) => receipts.push(args),
    uploadPreKeys: async () => {},
    sendPeerDataOperationMessage: async () => {},
    messageRetryManager,
    registerSocketEndHandler() {},
    issuePrivacyTokens: async () => {},
    fetchAccountReachoutTimelock: async () => {},
    placeholderResendCache: new MockNodeCache(),
    serverProps: {},
  };
  const logger = Object.fromEntries(
    ["trace", "debug", "info", "warn", "error"].map(level => [
      level,
      (...args) => logs.push({ level, args }),
    ]),
  );
  return {
    ws,
    setSocketOpen,
    sock,
    logger,
    upserts,
    retryAttempts,
    retryDecodeInputs,
    ackAttempts,
    nackAttempts,
    receipts,
    logs,
    sessionExists: jid => sessionIds.has(jid),
    get authSessionResetCount() {
      return authSessionResetCount;
    },
    waitForSessionReset: async () => {
      await waitFor(() => authSessionResetCount > 0);
    },
    releaseSessionReset,
    get maxAuthTransactionDepth() {
      return maxAuthTransactionDepth;
    },
    config: {
      logger,
      retryRequestDelayMs: retryDelayMs,
      maxMsgRetryCount: 5,
      getMessage: async () => undefined,
      shouldIgnoreJid: () => false,
      enableAutoSessionRecreation: true,
      enableRecentMessageCache: true,
      msgRetryCounterCache: new MockNodeCache(),
    },
  };
}

function child(node, tag) {
  return (node.content ?? []).find(entry => entry.tag === tag);
}

function mockValue(name, harness) {
  const generic = () => undefined;
  const values = {
    NodeCache: MockNodeCache,
    Boom: class Boom extends Error {},
    Long: {},
    proto: {
      WebMessageInfo: {
        StubType: { CIPHERTEXT: "ciphertext" },
        fromObject: value => value,
      },
      Message: { PeerDataOperationRequestType: {} },
    },
    DEFAULT_CACHE_TTLS: { MSG_RETRY: 3600, CALL_OFFER: 300 },
    KEY_BUNDLE_TYPE: "test",
    MIN_PREKEY_COUNT: 0,
    PLACEHOLDER_MAX_AGE_SECONDS: 60,
    STATUS_EXPIRY_SECONDS: 86400,
    ReachoutTimelockEnforcementType: {},
    WAMessageStatus: { ERROR: 0 },
    WAMessageStubType: {},
    ACCOUNT_RESTRICTED_TEXT: "restricted",
    MISSING_KEYS_ERROR_TEXT: "missing keys",
    NO_MESSAGE_FOUND_ERROR_TEXT: "message not found",
    NACK_REASONS: {
      MissingMessageSecret: 1,
      ParsingError: 2,
      UnhandledError: 500,
    },
    SERVER_ERROR_CODES: {},
    TC_TOKEN_INDEX_KEY: "test-index",
    S_WHATSAPP_NET: "s.whatsapp.net",
    makeMessagesSocket: () => harness.sock,
    makeMutex,
    makeOfflineNodeProcessor: () => ({ enqueue() {} }),
    buildAckStanza: (node, error, meId) => actualBuildAckStanza(node, error, meId),
    buildMergedTcTokenIndexWrite: async () => ({}),
    readTcTokenIndex: async () => [],
    decodeMessageNode: node => {
      harness.retryDecodeInputs.push(node);
      return actualDecodeMessageNode(
        node,
        harness.sock.authState.creds.me.id,
        harness.sock.authState.creds.me.lid,
      );
    },
    decryptMessageNode: node => {
      const failed = node.attrs.kind === "decrypt-failure";
      const { fullMessage, author } = actualDecodeMessageNode(
        node,
        harness.sock.authState.creds.me.id,
        harness.sock.authState.creds.me.lid,
      );
      return {
        fullMessage: {
          ...fullMessage,
          ...(failed
            ? {
                messageStubType: "ciphertext",
                messageStubParameters: ["test decryption failure"],
              }
            : { message: { conversation: "healthy payload" } }),
        },
        category: "message",
        author,
        decrypt: () => harness.sock.authState.keys.transaction(async () => {
          if (node.attrs.kind === "session-recovery") {
            await harness.sock.authState.keys.set({
              session: { [node.attrs.from]: { recovered: true } },
            });
          }
        }, node.attrs.from),
      };
    },
    getBinaryNodeChild: child,
    getBinaryNodeChildren: (node, tag) => (node.content ?? []).filter(item => item.tag === tag),
    getAllBinaryNodeChildren: node => node.content ?? [],
    isJidNewsletter: () => false,
    isJidStatusBroadcast: () => false,
    isLidUser: () => false,
    isPnUser: () => false,
    areJidsSameUser: (left, right) => left === right,
    jidNormalizedUser: jid => jid,
    jidDecode: jid => ({ user: jid, server: "s.whatsapp.net", device: 0 }),
    extractAddressingContext: actualExtractAddressingContext,
    cleanMessage: generic,
    getHistoryMsg: generic,
    unixTimestampSeconds: () => Math.floor(Date.now() / 1000),
    toNumber: value => Number(value),
    delay: ms => sleep(ms),
    encodeSignedDeviceIdentity: () => Buffer.alloc(1),
    encodeBigEndian: () => Buffer.alloc(1),
    getNextPreKeys: async () => ({ update: {}, preKeys: {} }),
    xmppPreKey: generic,
    xmppSignedPreKey: generic,
    randomBytes: nodeCrypto.randomBytes,
  };
  return Object.hasOwn(values, name) ? values[name] : generic;
}

function importedNames(source) {
  const imports = [];
  for (const match of source.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g)) {
    const clause = match[1].trim();
    const names = [];
    if (!clause.startsWith("{")) {
      names.push("default");
      const brace = clause.indexOf("{");
      if (brace !== -1) {
        names.push(
          ...clause
            .slice(brace + 1, clause.lastIndexOf("}"))
            .split(",")
            .map(entry => entry.trim().split(/\s+as\s+/)[0])
            .filter(Boolean),
        );
      }
    } else {
      names.push(
        ...clause
          .slice(1, clause.lastIndexOf("}"))
          .split(",")
          .map(entry => entry.trim().split(/\s+as\s+/)[0])
          .filter(Boolean),
      );
    }
    imports.push({ specifier: match[2], names });
  }
  return imports;
}

async function loadFactory(harness) {
  const source = await readFile(modulePath, "utf8");
  const context = createContext({ Buffer, console, setImmediate, setTimeout, clearTimeout });
  const root = new SourceTextModule(source, { context, identifier: modulePath });
  const mockModules = new Map();
  await root.link(async specifier => {
    if (mockModules.has(specifier)) return mockModules.get(specifier);
    const imported = importedNames(source).find(item => item.specifier === specifier);
    assert.ok(imported, `unexpected dependency request: ${specifier}`);
    const exports = imported.names;
    const module = new SyntheticModule(
      exports,
      function () {
        for (const name of exports) {
          const value =
            specifier === "crypto" && name === "randomBytes"
              ? nodeCrypto.randomBytes
              : specifier === "@cacheable/node-cache" && name === "default"
                ? MockNodeCache
              : mockValue(name, harness);
          this.setExport(name, value);
        }
      },
      { context, identifier: `mock:${specifier}` },
    );
    mockModules.set(specifier, module);
    return module;
  });
  await root.evaluate();
  return root.namespace.makeMessagesRecvSocket(harness.config);
}

function message(id, kind = "decrypt-failure", attrs = {}, withEnc = true) {
  return {
    tag: "message",
    attrs: { id, from: "15550000000@s.whatsapp.net", t: "1", ...attrs, kind },
    ...(withEnc
      ? { content: [{ tag: "enc", attrs: { type: "msg" }, content: Buffer.alloc(4096, 0x5a) }] }
      : {}),
  };
}

function compactNode(node) {
  return { tag: node.tag, attrs: { ...node.attrs } };
}

test("patch is pinned to the installed Baileys release in workspace and lockfile", async () => {
  const [workspace, lockfile, patch] = await Promise.all([
    readFile(resolve(workspaceRoot, "pnpm-workspace.yaml"), "utf8"),
    readFile(resolve(workspaceRoot, "pnpm-lock.yaml"), "utf8"),
    readFile(packagePatchPath),
  ]);
  const patchHash = nodeCrypto.createHash("sha256").update(patch).digest("hex");

  assert.match(
    workspace,
    /'@whiskeysockets\/baileys@7\.0\.0-rc14': patches\/@whiskeysockets__baileys@7\.0\.0-rc14\.patch/,
  );
  assert.match(lockfile, new RegExp(`hash: ${patchHash}`));
  assert.match(lockfile, new RegExp(`patch_hash=${patchHash}`));
  assert.match(lockfile, /specifier: 7\.0\.0-rc14/);
});

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail("timed out waiting for retry queue completion");
}

test("compact retry nodes preserve real decoder addressing and ACK output", async () => {
  const cases = [
    {
      id: "group-pn",
      attrs: {
        from: "120363000000000000@g.us",
        participant: "15550000001:4@s.whatsapp.net",
        participant_lid: "987654321:4@lid",
        addressing_mode: "pn",
        participant_username: "alice",
      },
    },
    {
      id: "self-recipient-pn",
      attrs: {
        from: ME_PN,
        recipient: "15550000002@s.whatsapp.net",
        recipient_lid: "987654322@lid",
        addressing_mode: "pn",
        peer_recipient_username: "bob",
      },
    },
    {
      id: "self-recipient-lid",
      attrs: {
        from: ME_LID,
        recipient: "15550000003@s.whatsapp.net",
        recipient_pn: "15550000003@s.whatsapp.net",
        addressing_mode: "lid",
      },
    },
    {
      id: "pn-sender-lid-alternate",
      attrs: {
        from: "15550000004:5@s.whatsapp.net",
        sender_lid: "987654323:5@lid",
        addressing_mode: "pn",
      },
      withEnc: false,
    },
  ];
  const harness = makeHarness();
  await loadFactory(harness);

  const originalNodes = cases.map(entry =>
    message(entry.id, "decrypt-failure", entry.attrs, entry.withEnc ?? true)
  );
  for (const node of originalNodes) {
    const compact = compactNode(node);
    assert.deepEqual(
      actualDecodeMessageNode(compact, ME_PN, ME_LID),
      actualDecodeMessageNode(node, ME_PN, ME_LID),
      `decoder output is unchanged for ${node.attrs.id}`,
    );
    assert.deepEqual(
      actualExtractAddressingContext(compact),
      actualExtractAddressingContext(node),
      `addressing context is unchanged for ${node.attrs.id}`,
    );
    assert.deepEqual(
      actualBuildAckStanza(compact, 500, ME_PN),
      actualBuildAckStanza(node, 500, ME_PN),
      `ACK output is unchanged for ${node.attrs.id}`,
    );
  }

  await Promise.all(
    originalNodes.map(node => harness.ws.dispatch("CB:message", node)),
  );
  await waitFor(() => harness.nackAttempts.length === cases.length);
  for (const node of originalNodes) {
    const { id } = node.attrs;
    const retry = harness.retryAttempts.find(attempt => attempt.id === id);
    const nack = harness.nackAttempts.find(attempt => attempt.id === id);
    assert.ok(retry, `retry receipt sent for ${id}`);
    assert.deepEqual(nack.stanza, actualBuildAckStanza(node, 500, ME_PN));
    assert.equal(retry.stanza.attrs.to, node.attrs.from);
    assert.equal(retry.stanza.attrs.recipient, node.attrs.recipient);
    assert.equal(retry.stanza.attrs.participant, node.attrs.participant);
  }
  assert.equal(
    harness.retryDecodeInputs.length,
    cases.length,
    "sendRetryRequest used the real decoder on each compact entry",
  );
  assert.ok(
    harness.retryDecodeInputs.every(node =>
      node.content === undefined &&
      Object.keys(node).sort().join(",") === "attrs,tag"
    ),
    "the retry queue retains stanza attributes without ciphertext/content",
  );
  const missingEncryptionRetry = harness.retryAttempts.find(attempt =>
    attempt.id === "pn-sender-lid-alternate"
  );
  assert.ok(
    child(missingEncryptionRetry.stanza, "keys"),
    "forceIncludeKeys was computed from the original stanza before compaction",
  );
});

test("patched receive handler keeps decrypt/upsert responsive and retry work FIFO/throttled", async () => {
  const harness = makeHarness();
  await loadFactory(harness);
  await Promise.all([
    harness.sock.authState.keys.transaction(() => sleep(20), "signal-key-a"),
    harness.sock.authState.keys.transaction(() => sleep(20), "signal-key-b"),
  ]);
  assert.ok(
    harness.maxAuthTransactionDepth >= 2,
    "the auth-key transaction mock allows unrelated keyed transactions to overlap",
  );
  const failedIds = Array.from({ length: 45 }, (_, index) => `failed-${index}`);
  const startedAt = performance.now();
  const handling = [
    ...failedIds.map(id => harness.ws.dispatch("CB:message", message(id))),
    harness.ws.dispatch("CB:message", message("healthy-behind-failures", "healthy")),
  ];

  await Promise.all(handling);
  const healthyLatencyMs = performance.now() - startedAt;
  assert.ok(
    healthyLatencyMs < 350,
    `healthy upsert waited ${healthyLatencyMs.toFixed(1)}ms behind retry throttling`,
  );
  assert.ok(harness.upserts.some(entry => entry.id === "healthy-behind-failures"));
  assert.deepEqual(
    harness.upserts.slice(0, failedIds.length + 1).map(entry => entry.id),
    [...failedIds, "healthy-behind-failures"],
    "all failed-message stubs and the following healthy message are upserted in order",
  );

  await waitFor(() => harness.nackAttempts.length === failedIds.length);
  assert.deepEqual(
    harness.retryAttempts.map(entry => entry.id),
    failedIds,
    "retry requests retain FIFO order",
  );
  assert.ok(
    harness.retryAttempts.slice(1).every((attempt, index) =>
      attempt.at - harness.retryAttempts[index].at >= retryDelayMs - 5
    ),
    "retry sends remain rate-throttled",
  );
  assert.deepEqual(
    harness.nackAttempts.map(entry => entry.id),
    failedIds,
    "every retry receives exactly one NACK",
  );
  assert.ok(harness.nackAttempts.every(entry => entry.error === "500"));
  assert.equal(harness.retryDecodeInputs.length, failedIds.length);
  assert.ok(harness.retryDecodeInputs.every(node => node.content === undefined));

  const backlogLogs = harness.logs.filter(entry =>
    entry.level === "warn" && entry.args.some(arg => arg?.retryQueueDepth >= 5),
  );
  const [backlogLog] = backlogLogs;
  assert.ok(backlogLog, "slow retry backlog logs queue depth");
  assert.equal(backlogLogs.length, 1, "retry backlog diagnostics are throttled");
  const logText = JSON.stringify(backlogLog.args);
  assert.match(logText, /oldestRetryAgeMs/);
  assert.doesNotMatch(logText, /failed-\d+/i, "retry backlog logs contain no message IDs");
});

test("retry session reset holds messageMutex against keyed decrypt recovery", async () => {
  const harness = makeHarness({ delaySessionReset: true });
  await loadFactory(harness);
  const peerJid = "15550000001@s.whatsapp.net";
  const repeatedId = "same-retry-id";

  await harness.ws.dispatch(
    "CB:message",
    message(repeatedId, "decrypt-failure", { from: peerJid }),
  );
  await waitFor(() => harness.nackAttempts.length === 1);

  await harness.ws.dispatch(
    "CB:message",
    message(repeatedId, "decrypt-failure", { from: peerJid }),
  );
  await harness.waitForSessionReset();
  const recovery = harness.ws.dispatch(
    "CB:message",
    message("session-recovery", "session-recovery", { from: peerJid }),
  );
  const recoveryCompletedWhileResetWasPending = await Promise.race([
    recovery.then(() => true),
    sleep(50).then(() => false),
  ]);
  harness.releaseSessionReset();
  await recovery;
  await waitFor(() => harness.nackAttempts.length === 2);

  assert.equal(
    recoveryCompletedWhileResetWasPending,
    false,
    "decrypt recovery waits until the retry's non-transactional session reset and NACK release messageMutex",
  );
  assert.equal(harness.sessionExists(peerJid), true, "the completed recovery session remains present");
});

test("retry send and ACK failures are contained, ACK ownership is not duplicated, and recovery continues", async () => {
  const harness = makeHarness({
    retrySendErrors: ["send-error", "second-send-error"],
    ackErrors: ["send-error"],
  });
  await loadFactory(harness);

  await Promise.all([
    harness.ws.dispatch("CB:message", message("send-error")),
    harness.ws.dispatch("CB:message", message("second-send-error")),
  ]);
  await waitFor(() => harness.nackAttempts.length === 2);
  assert.equal(harness.nackAttempts.filter(entry => entry.id === "send-error").length, 1);
  assert.ok(
    harness.retryAttempts[1].at - harness.retryAttempts[0].at >= retryDelayMs - 5,
    "the retry throttle remains in effect after send failures",
  );
  assert.ok(harness.logs.some(entry => entry.level === "error" && entry.args.includes("Failed to send retry")));
  assert.ok(harness.logs.some(entry => entry.level === "error" && entry.args.includes("failed to ack message after error")));

  await harness.ws.dispatch("CB:message", message("recovered-after-errors", "healthy"));
  assert.ok(harness.upserts.some(entry => entry.id === "recovered-after-errors"));
});

test("socket closure during retry send skips the NACK", async () => {
  const harness = makeHarness({ closeDuringRetrySend: ["closed-during-send"] });
  await loadFactory(harness);

  await harness.ws.dispatch("CB:message", message("closed-during-send"));
  await waitFor(() => harness.retryAttempts.length === 1);
  await sleep(25);

  assert.equal(harness.ws.isOpen, false);
  assert.equal(harness.nackAttempts.length, 0, "a close during send prevents a later NACK write");
});

test("closed websocket drains queued work without retry or NACK writes", async () => {
  const harness = makeHarness({ open: false });
  await loadFactory(harness);
  const closedIds = Array.from({ length: 12 }, (_, index) => `closed-${index}`);
  await Promise.all(closedIds.map(id => harness.ws.dispatch("CB:message", message(id))));
  await sleep(20);

  assert.deepEqual(harness.retryAttempts, []);
  assert.deepEqual(harness.nackAttempts, []);
  assert.equal(harness.logs.filter(entry => entry.level === "warn").length, 0);
  assert.deepEqual(
    harness.upserts.map(entry => entry.id),
    closedIds,
    "socket closure does not prevent ordered message recovery/upserts",
  );
});