import {
  makeCacheableSignalKeyStore,
  type SignalKeyStore,
  type SignalKeyStoreWithTransaction,
} from "@whiskeysockets/baileys";

/**
 * Adds Baileys' in-memory key cache without allowing its eager cache updates
 * to become visible until the backing store has completed the write.
 */
export function makeSafeCacheableSignalKeyStore(
  store: SignalKeyStore | SignalKeyStoreWithTransaction,
): SignalKeyStore {
  // Do not expose clear to Baileys' cache wrapper: its clear() also invokes
  // store.clear(), which would erase persistent authentication state.
  const cacheBacking: SignalKeyStore = {
    get: store.get.bind(store),
    set: store.set.bind(store),
  };
  // Keep Baileys' default cache options (including useClones: false). The
  // multi-file auth adapter reconstructs app-state keys with
  // proto.Message.AppStateSyncKeyData.fromObject after JSON decoding; generic
  // cloning here could erase that protobuf prototype. As with Baileys' own
  // cache, returned key objects are shared references: callers that mutate a
  // key in place without set() can make the memory value diverge from disk.
  // The adapter itself serializes on write and reconstructs on read rather
  // than mutating returned keys in place.
  const createCachedStore = () => makeCacheableSignalKeyStore(cacheBacking);
  let cachedStore = createCachedStore();
  let cacheUnavailable = false;
  let cacheUnavailableError: unknown;

  // Serialize reads and writes around Baileys' cache as well as the backing
  // store. Recover the tail after either outcome so one rejection cannot
  // prevent later operations from running.
  let tail: Promise<void> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const assertCacheAvailable = () => {
    if (cacheUnavailable) {
      throw cacheUnavailableError;
    }
  };

  const replaceCachedStore = () => {
    try {
      cachedStore = createCachedStore();
      cacheUnavailable = false;
      cacheUnavailableError = undefined;
    } catch (error) {
      // Fail closed if a fresh official cache cannot be constructed: never
      // fall back to an instance that might contain uncommitted values.
      cacheUnavailable = true;
      cacheUnavailableError = error;
      throw error;
    }
  };

  const invalidateCache = async () => {
    if (cacheUnavailable) {
      replaceCachedStore();
      return;
    }
    if (typeof cachedStore.clear !== "function") {
      replaceCachedStore();
      return;
    }
    try {
      await cachedStore.clear();
    } catch {
      // Discard the cache instance on clear failure. A replacement ensures
      // that no stale/uncommitted entry remains reachable; if replacement
      // fails, replaceCachedStore marks the wrapper fail-closed.
      replaceCachedStore();
    }
  };

  const containsDeletion = (data: Parameters<SignalKeyStore["set"]>[0]) =>
    Object.values(data).some(
      (category) =>
        category && Object.values(category).some((value) => value === null),
    );

  const safeStore: SignalKeyStore = {
    get<T extends Parameters<SignalKeyStore["get"]>[0]>(type: T, ids: string[]) {
      return serialize(async () => {
        assertCacheAvailable();
        return cachedStore.get(type, ids);
      });
    },
    set(data) {
      return serialize(async () => {
        assertCacheAvailable();
        try {
          // Baileys' cache writes entries before awaiting store.set().
          await cachedStore.set(data);
        } catch (error) {
          // Keep the original backing-store error and do not release the
          // outer lock until the cache no longer contains uncommitted values.
          // If invalidation and replacement both fail, the wrapper is marked
          // unavailable so later reads/writes cannot reach the stale cache.
          try {
            await invalidateCache();
          } catch {
            // Preserve the exact backing error; invalidateCache has failed
            // closed instead of retaining access to the old cache instance.
          }
          throw error;
        }

        // Baileys caches null deletion markers as ordinary values. Drop the
        // memory cache after a successful delete so reads reflect absence.
        if (containsDeletion(data)) {
          await invalidateCache();
        }
      });
    },
    clear() {
      // This only clears the in-memory Baileys cache; cacheBacking has no
      // clear method, so persistent auth remains untouched.
      return serialize(invalidateCache);
    },
  };

  return safeStore;
}