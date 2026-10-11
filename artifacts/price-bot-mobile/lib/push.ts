import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { registerPushDevice, removePushDevice, type PushPreferences } from '@workspace/api-client-react';
import { keys, prefs } from '@/lib/storage';

/**
 * Push notifications. They need Firebase (google-services.json in the build and a
 * service account on the server); until then every call here quietly reports
 * "not configured" and the rest of the app works the same.
 */
export type PushState =
  | { ok: true; preferences: PushPreferences }
  | { ok: false; reason: 'unsupported' | 'not-configured' | 'denied' | 'error'; message?: string };

export const pushConfigured = Boolean(Constants.expoConfig?.extra?.pushEnabled);

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false,
    }),
  });
}

export async function registerForPush(preferences?: PushPreferences): Promise<PushState> {
  if (Platform.OS === 'web' || !Device.isDevice) return { ok: false, reason: 'unsupported' };
  if (!pushConfigured) return { ok: false, reason: 'not-configured' };
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'התראות המחירון',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 120, 200],
        lightColor: '#3DDC97',
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'denied' };
    const token = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== 'string' || !token) return { ok: false, reason: 'error', message: 'no token' };
    const device = await registerPushDevice({
      token, platform: Platform.OS === 'ios' ? 'ios' : 'android', ...(preferences ? { preferences } : {}),
    });
    await prefs.set(keys.pushToken, token);
    return { ok: true, preferences: device.preferences };
  } catch (error) {
    return { ok: false, reason: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function unregisterPush() {
  const token = await prefs.get<string | null>(keys.pushToken, null);
  if (!token) return;
  await removePushDevice({ token }).catch(() => undefined);
  await prefs.set(keys.pushToken, null);
}
