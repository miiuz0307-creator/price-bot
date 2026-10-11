import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/ui';
import { useTheme } from '@/lib/theme';
import { errorMessage } from '@/lib/api';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; kind: ToastKind; text: string };

const ToastContext = createContext<{
  show: (text: string, kind?: ToastKind) => void;
  error: (error: unknown, fallback?: string) => void;
} | null>(null);

/** One message at a time, sliding in from the top; errors stay a little longer. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string, kind: ToastKind = 'success') => {
    counter.current += 1;
    setToast({ id: counter.current, kind, text });
    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(kind === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
  }, []);
  const value = useMemo(() => ({
    show,
    error: (error: unknown, fallback?: string) => show(errorMessage(error, fallback), 'error'),
  }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <ToastView key={toast.id} toast={toast} onDone={() => setToast((current) => (current?.id === toast.id ? null : current))} /> : null}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: native, bounciness: 7 }).start();
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 200, useNativeDriver: native }).start(onDone);
    }, toast.kind === 'error' ? 4500 : 2600);
    return () => clearTimeout(timer);
  }, [anim, native, onDone, toast.kind]);
  const tone = toast.kind === 'error'
    ? { bg: c.dangerBg, border: c.dangerLine, fg: c.dangerText, icon: 'alert-circle' as const, iconColor: c.danger }
    : toast.kind === 'info'
      ? { bg: c.surface, border: c.line, fg: c.text, icon: 'info' as const, iconColor: c.muted }
      : { bg: c.mintTint, border: c.mintLine, fg: c.text, icon: 'check-circle' as const, iconColor: c.mint };
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute', top: insets.top + 8, left: 16, right: 16, direction: 'rtl',
        opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
      }}
    >
      <Pressable onPress={onDone} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
          <Icon name={tone.icon} size={20} color={tone.iconColor} />
          <Txt variant="bodyMedium" color={tone.fg} style={{ flex: 1 }}>{toast.text}</Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast outside ToastProvider');
  return value;
}
