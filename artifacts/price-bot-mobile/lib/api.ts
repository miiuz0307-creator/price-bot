import Constants from 'expo-constants';
import { setBaseUrl } from '@workspace/api-client-react';

/**
 * Server address. Built into the app (app.json → extra.apiUrl); the web preview
 * is served by the server itself, so it uses the same origin ("").
 */
const configured = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? '';
export const apiUrl = configured.replace(/\/+$/, '');
setBaseUrl(apiUrl || null);

/** Sign-in calls send this header so the server returns a token instead of relying on cookies. */
export const mobileClient = { headers: { 'x-price-bot-client': 'mobile' } };

/** Human (Hebrew) message for any API / network error. */
export function errorMessage(error: unknown, fallback = 'משהו השתבש. נסו שוב.'): string {
  if (!error) return fallback;
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  const status = (error as { status?: number }).status;
  if (status === 401) return 'נדרשת התחברות מחדש';
  if (status === 403) return 'אין לך הרשאה לפעולה הזו';
  if (status === 404) return 'הפריט לא נמצא (אולי נמחק)';
  if (status && status >= 500) return 'השרת לא זמין כרגע. נסו שוב בעוד רגע.';
  const message = error instanceof Error ? error.message : String(error);
  if (/network|fetch|Failed to fetch|Network request failed|timeout/i.test(message)) return 'אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.';
  return fallback;
}

export const isUnauthorized = (error: unknown) => (error as { status?: number } | null)?.status === 401;
