import type { SignalKeyStore, SignalKeyStoreWithTransaction } from "@whiskeysockets/baileys";

/**
 * In-memory key store over the multi-file auth state, with write-behind.
 *
 * Every incoming WhatsApp message updates encryption keys. Waiting for the
 * disk on each update capped the bot at ~3 messages/second (≈0.35 s per
 * decrypt on the hosting volume), so busy groups built a queue of minutes and
 * price requests waited behind it. Writes now land in memory immediately and
 * are persisted to disk in the background, in order, merged, and flushed on
 * shutdown. Reads see the newest value (memory first, then disk).
 *
 * Deletions are kept as "absent" in memory, so a deleted key is never
 * resurrected from disk while its removal is still being written.
 */
export type SlowKeyStoreReport = {
  operation: "get" | "set" | "flush"; queueWaitMs: number; runMs: number; diskMs: number;
  type?: string; count: number; queueDepth: number;
};

export type FlushableSignalKeyStore = SignalKeyStore & {
  /** Resolves when every write made so far is on disk. */
  flush(): Promise<void>;
};

type Entry = { value: unknown; touchedAt: number };

const memoryLifetimeMs = 30 * 60_000;
const maxMemoryEntries = 50_000;

const liveStores = new Set<FlushableSignalKeyStore>();

/** Persist pending key writes of every connection (called on shutdown). */
export async function flushAllKeyStores(timeoutMs = 8_000) {
  await Promise.race([
    Promise.allSettled([...liveStores].map((store) => store.flush())),
    new Promise((resolve) => setTimeout(resolve, timeoutMs).unref?.()),
  ]);
}

export function makeSafeCacheableSignalKeyStore(
  store: SignalKeyStore | SignalKeyStoreWithTransaction,
  onSlow?: (report: SlowKeyStoreReport) => void,
): FlushableSignalKeyStore {
  const key = (type: string, id: string) => `${type}\u0000${id}`;
  /** Known values (null = known to be absent). */
  const memory = new Map<string, Entry>();
  /** Writes not yet on disk, in arrival order, merged per key. */
  let pending = new Map<string, { type: string; id: string; value: unknown }>();
  let writer: Promise<void> | null = null;

  const report = (entry: SlowKeyStoreReport) => {
    try {
      onSlow?.(entry);
    } catch {
      // Reporting must never affect key storage.
    }
  };

  const remember = (type: string, id: string, value: unknown) => {
    memory.set(key(type, id), { value, touchedAt: Date.now() });
  };

  const prune = () => {
    if (memory.size <= maxMemoryEntries) return;
    const cutoff = Date.now() - memoryLifetimeMs;
    for (const [compound, entry] of memory) {
      if (memory.size <= maxMemoryEntries * 0.8) break;
      if (entry.touchedAt < cutoff && !pending.has(compound)) memory.delete(compound);
    }
  };

  const writeLoop = async () => {
    let delayMs = 0;
    while (pending.size) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const batch = pending;
      pending = new Map();
      const data: Record<string, Record<string, unknown>> = {};
      for (const { type, id, value } of batch.values()) (data[type] ??= {})[id] = value;
      const startedAt = Date.now();
      try {
        await store.set(data as Parameters<SignalKeyStore["set"]>[0]);
        delayMs = 0;
        const runMs = Date.now() - startedAt;
        if (runMs > 2000) report({ operation: "flush", queueWaitMs: 0, runMs, diskMs: runMs, type: Object.keys(data).join(","), count: batch.size, queueDepth: pending.size });
      } catch (error) {
        // Put the failed batch back (newer writes made meanwhile win) and retry.
        for (const [compound, write] of batch) if (!pending.has(compound)) pending.set(compound, write);
        delayMs = Math.min((delayMs || 500) * 2, 10_000);
        report({ operation: "flush", queueWaitMs: 0, runMs: Date.now() - startedAt, diskMs: Date.now() - startedAt, type: `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200), count: batch.size, queueDepth: pending.size });
      }
    }
  };

  const startWriter = () => {
    if (writer) return writer;
    writer = writeLoop().finally(() => {
      writer = null;
      if (pending.size) void startWriter();
    });
    return writer;
  };

  const keyStore: FlushableSignalKeyStore = {
    async get(type, ids) {
      const result: Record<string, unknown> = {};
      const missing: string[] = [];
      for (const id of ids) {
        const entry = memory.get(key(type, id));
        if (!entry) {
          missing.push(id);
          continue;
        }
        entry.touchedAt = Date.now();
        if (entry.value !== null && entry.value !== undefined) result[id] = entry.value;
      }
      if (missing.length) {
        const startedAt = Date.now();
        const fromDisk = await store.get(type, missing) as Record<string, unknown>;
        const runMs = Date.now() - startedAt;
        if (runMs > 2000) report({ operation: "get", queueWaitMs: 0, runMs, diskMs: runMs, type, count: missing.length, queueDepth: pending.size });
        for (const id of missing) {
          // A write made while the disk read was running is newer: keep it.
          const current = memory.get(key(type, id));
          if (current) {
            if (current.value !== null && current.value !== undefined) result[id] = current.value;
            continue;
          }
          const value = fromDisk?.[id];
          remember(type, id, value ?? null);
          if (value !== null && value !== undefined) result[id] = value;
        }
        prune();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return result as any;
    },
    async set(data) {
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values ?? {})) {
          remember(type, id, value ?? null);
          pending.set(key(type, id), { type, id, value: value ?? null });
        }
      }
      void startWriter();
    },
    async clear() {
      // Only forget memory; persistent authentication on disk stays untouched.
      await keyStore.flush();
      memory.clear();
    },
    async flush() {
      while (pending.size || writer) await startWriter();
    },
  };

  liveStores.add(keyStore);
  return keyStore;
}
