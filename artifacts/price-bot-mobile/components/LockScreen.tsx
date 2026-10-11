import React, { useEffect } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/Icon';
import { Button, Txt } from '@/components/ui';
import { firstName } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';

export function BrandMark({ size = 72 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c.scheme === 'dark' ? '#1B3834' : c.mintSoft, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="whatsapp" size={size * 0.5} color={c.mint} strokeWidth={2.2} />
      <Txt variant="h3" color={c.mint} style={{ position: 'absolute', fontSize: size * 0.2, lineHeight: size * 0.26 }}>₪</Txt>
    </View>
  );
}

/** Biometric unlock after the app was closed (the session itself stays signed in). */
export function LockScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { admin, unlock, signOut } = useSession();
  useEffect(() => { void unlock(); }, [unlock]);
  return (
    <View style={{ flex: 1, direction: 'rtl', backgroundColor: c.bg, paddingTop: insets.top + 96, paddingBottom: insets.bottom + 32, paddingHorizontal: 24, gap: 18 }}>
      <BrandMark />
      <View style={{ gap: 8 }}>
        <Txt variant="h1">שלום{admin ? ` ${firstName(admin.label)}` : ''}</Txt>
        <Txt variant="body" color={c.muted}>המחירון נעול. פתחו בטביעת אצבע, בזיהוי פנים או בקוד המכשיר.</Txt>
      </View>
      <View style={{ flex: 1 }} />
      <Button title="פתיחה" icon="unlock" onPress={() => void unlock()} />
      <Button title="כניסה עם משתמש אחר" variant="ghost" onPress={() => void signOut({ local: true })} />
    </View>
  );
}

export function OfflineScreen() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { retry, signOut } = useSession();
  return (
    <View style={{ flex: 1, direction: 'rtl', backgroundColor: c.bg, paddingTop: insets.top + 96, paddingBottom: insets.bottom + 32, paddingHorizontal: 24, gap: 18 }}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: c.dangerBg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="wifi-off" size={32} color={c.danger} />
      </View>
      <View style={{ gap: 8 }}>
        <Txt variant="h1">אין חיבור לשרת</Txt>
        <Txt variant="body" color={c.muted}>בדקו שהטלפון מחובר לאינטרנט. הכניסה שלכם שמורה — אין צורך להתחבר מחדש.</Txt>
      </View>
      <View style={{ flex: 1 }} />
      <Button title="נסו שוב" icon="refresh-cw" onPress={retry} />
      <Button title="יציאה מהחשבון" variant="ghost" onPress={() => void signOut({ local: true })} />
    </View>
  );
}
