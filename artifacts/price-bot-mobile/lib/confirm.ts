import { Alert, Platform } from 'react-native';

/** Confirm dialog that also works in the web preview. */
export function confirm(title: string, message: string, action: string, destructive = true): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve((globalThis as { confirm?: (message: string) => boolean }).confirm?.(`${title}\n${message}`) ?? true);
  return new Promise((resolve) => Alert.alert(title, message, [
    { text: 'ביטול', style: 'cancel', onPress: () => resolve(false) },
    { text: action, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
}
