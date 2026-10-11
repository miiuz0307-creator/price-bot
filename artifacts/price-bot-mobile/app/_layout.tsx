import '@/lib/api';
import React, { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
import { focusManager, MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Heebo_400Regular, Heebo_500Medium, Heebo_600SemiBold } from '@expo-google-fonts/heebo';
import { Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold } from '@expo-google-fonts/rubik';
import { Feather } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { LockScreen, OfflineScreen } from '@/components/LockScreen';
import { handleApiError, SessionProvider, useSession } from '@/lib/session';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { registerForPush } from '@/lib/push';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleApiError }),
  mutationCache: new MutationCache({ onError: handleApiError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, error) => {
        const status = (error as unknown as { status?: number })?.status;
        return count < 2 && (status === undefined || status >= 500);
      },
    },
  },
});

// Refresh data when the app comes back to the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
}

const webDocument = (globalThis as { document?: { documentElement: { dir: string; lang: string } } }).document;
if (Platform.OS === 'web' && webDocument) {
  webDocument.documentElement.dir = 'rtl';
  webDocument.documentElement.lang = 'he';
}

const pushRoutes: Record<string, string> = { requests: '/requests', whatsapp: '/whatsapp', surge: '/surge' };

function AppNavigator() {
  const { c } = useTheme();
  const { status } = useSession();
  const signedIn = status === 'signedIn';

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync().catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return;
    void registerForPush();
    // Tapping a notification opens the matching screen.
    const open = (response: Notifications.NotificationResponse | null) => {
      const screen = response?.notification.request.content.data?.screen;
      if (typeof screen === 'string' && pushRoutes[screen]) router.push(pushRoutes[screen] as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [signedIn]);

  if (status === 'loading') return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  if (status === 'locked') return <LockScreen />;
  if (status === 'offline') return <OfflineScreen />;

  return (
    <Stack screenOptions={{
      headerShown: false,
      contentStyle: { backgroundColor: c.bg },
      animation: Platform.OS === 'web' ? 'none' : 'slide_from_left',
    }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="product/[id]" />
        <Stack.Screen name="product/edit" options={{ animation: Platform.OS === 'web' ? 'none' : 'slide_from_bottom' }} />
        <Stack.Screen name="whatsapp" />
        <Stack.Screen name="targets" />
        <Stack.Screen name="abbreviations" />
        <Stack.Screen name="users" />
        <Stack.Screen name="activity" />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
      </Stack.Protected>
    </Stack>
  );
}

function Themed({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, direction: 'rtl' }}>
      <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Heebo_400Regular, Heebo_500Medium, Heebo_600SemiBold,
    Rubik_500Medium, Rubik_600SemiBold, Rubik_700Bold,
    ...Feather.font,
  });
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Themed>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <ToastProvider>
                    <SessionProvider>
                      <AppNavigator />
                    </SessionProvider>
                  </ToastProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </Themed>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
