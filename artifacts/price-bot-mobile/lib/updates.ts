import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import * as Updates from 'expo-updates';

/**
 * Online updates: the app downloads new code from our own server.
 * - On every launch (checkAutomatically: ON_LOAD) a new version downloads in the
 *   background and is used from the next launch.
 * - When the app comes back to the foreground after a while, it checks again and,
 *   if there is something new, restarts into it right away (about a second).
 */
export function useOnlineUpdates() {
  const backgroundSince = useRef<number | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { backgroundSince.current ??= Date.now(); return; }
      const away = backgroundSince.current ? Date.now() - backgroundSince.current : 0;
      backgroundSince.current = null;
      if (away < 30_000) return;
      void (async () => {
        try {
          const check = await Updates.checkForUpdateAsync();
          if (!check.isAvailable) return;
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched.isNew) await Updates.reloadAsync();
        } catch {
          // Offline or server busy: try again next time.
        }
      })();
    });
    return () => subscription.remove();
  }, []);
}

/** Manual "check for updates" (from the More screen). */
export async function checkForUpdateNow(): Promise<'updated' | 'latest' | 'unavailable'> {
  if (Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return 'unavailable';
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return 'latest';
  await Updates.fetchUpdateAsync();
  await Updates.reloadAsync();
  return 'updated';
}

/** "1.0.0 · עדכון 11.10 21:40" or "1.0.0 · גרסה מובנית" */
export function versionLabel(appVersion: string) {
  if (Platform.OS === 'web') return appVersion;
  if (Updates.isEmbeddedLaunch || !Updates.createdAt) return `${appVersion} · גרסה מובנית`;
  const date = Updates.createdAt.toLocaleString('he-IL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  return `${appVersion} · עדכון ${date}`;
}
