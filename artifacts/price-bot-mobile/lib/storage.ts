import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

const webStorage = () => (globalThis as { localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } }).localStorage;

/** Secrets (session token) live in the phone's keystore; on the web preview, in localStorage. */
export const secure = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return webStorage()?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string) {
    try {
      if (Platform.OS === 'web') webStorage()?.setItem(key, value);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Storage unavailable: the user simply signs in again next time.
    }
  },
  async remove(key: string) {
    try {
      if (Platform.OS === 'web') webStorage()?.removeItem(key);
      else await SecureStore.deleteItemAsync(key);
    } catch {
      // ignore
    }
  },
};

/** Non-secret preferences (theme, biometric unlock, last identifier). */
export const prefs = {
  async get<T>(key: string, fallback: T): Promise<T> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  async set(key: string, value: unknown) {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  },
};

export const keys = {
  token: 'pricebot.session',
  identifier: 'pricebot.identifier',
  theme: 'pricebot.theme',
  biometric: 'pricebot.biometric',
  pushToken: 'pricebot.pushToken',
};
