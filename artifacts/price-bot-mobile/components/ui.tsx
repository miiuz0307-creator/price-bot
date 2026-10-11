import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl,
  ScrollView, StyleSheet, Text, TextInput, View,
  type PressableProps, type StyleProp, type TextInputProps, type TextProps, type TextStyle, type ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { fonts } from '@/constants/theme';
import { useTheme } from '@/lib/theme';

export const tap = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
  if (Platform.OS !== 'web') void Haptics.impactAsync(style).catch(() => undefined);
};

// ---------- Text ----------

type Variant = 'body' | 'bodyMedium' | 'bodySemi' | 'caption' | 'label' | 'h1' | 'h2' | 'h3' | 'num' | 'numLg' | 'numXl';
const variants: Record<Variant, TextStyle> = {
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.bodyMedium, fontSize: 15, lineHeight: 22 },
  bodySemi: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
  label: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  h1: { fontFamily: fonts.head, fontSize: 28, lineHeight: 34 },
  h2: { fontFamily: fonts.head, fontSize: 22, lineHeight: 28 },
  h3: { fontFamily: fonts.headSemi, fontSize: 17, lineHeight: 23 },
  num: { fontFamily: fonts.head, fontSize: 18, lineHeight: 23 },
  numLg: { fontFamily: fonts.head, fontSize: 26, lineHeight: 31 },
  numXl: { fontFamily: fonts.head, fontSize: 32, lineHeight: 36 },
};

export function Txt({ variant = 'body', color, style, center, ...props }: TextProps & { variant?: Variant; color?: string; center?: boolean }) {
  const { c } = useTheme();
  return <Text {...props} style={[variants[variant], { color: color ?? c.text, textAlign: center ? 'center' : 'right' }, style]} />;
}

// ---------- Layout ----------

/** Screen body: safe-area aware, RTL, scrollable with pull-to-refresh. */
export function Screen({
  children, scroll = true, refreshing, onRefresh, padded = true, footer, contentStyle, topInset = true,
}: {
  children: React.ReactNode; scroll?: boolean; refreshing?: boolean; onRefresh?: () => void; padded?: boolean;
  footer?: React.ReactNode; contentStyle?: StyleProp<ViewStyle>; topInset?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const body = [{ paddingHorizontal: padded ? 20 : 0, paddingTop: topInset ? insets.top + 14 : 8, gap: 16 }, contentStyle];
  return (
    <KeyboardAvoidingView style={[styles.fill, { backgroundColor: c.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? (
        <ScrollView
          style={styles.fill}
          contentContainerStyle={[body, { paddingBottom: 28 }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={c.mint} colors={[c.mint]} progressBackgroundColor={c.surface} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.fill, body]}>{children}</View>
      )}
      {footer}
    </KeyboardAvoidingView>
  );
}

/** Sticky bottom action area (e.g. "Send on WhatsApp"). */
export function Footer({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.row, { gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) + 8, backgroundColor: c.nav, borderTopWidth: 1, borderTopColor: c.lineSoft }]}>
      {children}
    </View>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="h1" accessibilityRole="header">{title}</Txt>
        {subtitle ? <Txt variant="label" color={c.muted}>{subtitle}</Txt> : null}
      </View>
      {action}
    </View>
  );
}

/** Header for pushed screens: back arrow (points right in Hebrew) + title + optional action. */
export function BackHeader({ title, action, onBack }: { title?: string; action?: React.ReactNode; onBack?: () => void }) {
  const { c } = useTheme();
  return (
    <View style={[styles.row, { alignItems: 'center', justifyContent: 'space-between', marginHorizontal: -8, minHeight: 44 }]}>
      <View style={[styles.row, { alignItems: 'center', gap: 4, flex: 1 }]}>
        <Press
          accessibilityLabel="חזרה"
          onPress={onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')))}
          style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-right" size={26} color={c.text} />
        </Press>
        {title ? <Txt variant="h2" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">{title}</Txt> : null}
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style, tone = 'default', onPress, accessibilityLabel }: {
  children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'default' | 'amber' | 'mint' | 'danger';
  onPress?: () => void; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const tones = {
    default: { backgroundColor: c.surface, borderColor: c.line },
    amber: { backgroundColor: c.amberBg, borderColor: c.amberLine },
    mint: { backgroundColor: c.mintTint, borderColor: c.mintLine },
    danger: { backgroundColor: c.dangerBg, borderColor: c.dangerLine },
  };
  const base = [{ borderRadius: 20, borderWidth: 1, padding: 16 }, tones[tone], style];
  if (!onPress) return <View style={base}>{children}</View>;
  return <Press onPress={onPress} accessibilityLabel={accessibilityLabel} style={base}>{children}</Press>;
}

export function Row({ children, style, gap = 12, align = 'center' }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number; align?: ViewStyle['alignItems'] }) {
  return <View style={[styles.row, { gap, alignItems: align }, style]}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
      <Txt variant="h3">{title}</Txt>
      {action}
    </Row>
  );
}

// ---------- Pressables ----------

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with a gentle press-down scale and haptic tick. */
export function Press({ style, onPress, haptic = true, children, disabled, ...props }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; haptic?: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.timing(scale, { toValue: value, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...props}
      disabled={disabled}
      onPressIn={() => to(0.97)}
      onPressOut={() => to(1)}
      onPress={(event) => { if (haptic) tap(); onPress?.(event); }}
      style={[style, { transform: [{ scale }], opacity: disabled ? 0.5 : 1 }]}
    >
      {children}
    </AnimatedPressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'amber' | 'soft';
export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, size = 'lg', accessibilityLabel }: {
  title?: string; onPress?: () => void; variant?: ButtonVariant; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; size?: 'md' | 'lg'; accessibilityLabel?: string;
}) {
  const { c } = useTheme();
  const look: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: c.mint, fg: c.onMint, border: c.mint },
    secondary: { bg: c.surface2, fg: c.text, border: c.line },
    ghost: { bg: 'transparent', fg: c.text, border: c.line },
    danger: { bg: c.dangerBg, fg: c.danger, border: c.dangerLine },
    amber: { bg: c.amber, fg: c.onAmber, border: c.amber },
    soft: { bg: c.mintTint, fg: c.mint, border: c.mintLine },
  };
  const { bg, fg, border } = look[variant];
  return (
    <Press
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={accessibilityLabel ?? title}
      style={[{
        minHeight: size === 'lg' ? 54 : 44, paddingHorizontal: title ? 18 : 0, minWidth: title ? undefined : size === 'lg' ? 54 : 44,
        borderRadius: size === 'lg' ? 16 : 13, backgroundColor: bg, borderWidth: 1, borderColor: border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={19} color={fg} /> : null}
      {title ? <Txt variant="bodySemi" color={fg} style={{ fontSize: size === 'lg' ? 16 : 14 }}>{title}</Txt> : null}
    </Press>
  );
}

export function IconButton({ icon, onPress, label, badge, tone = 'surface' }: { icon: IconName; onPress?: () => void; label: string; badge?: boolean; tone?: 'surface' | 'plain' }) {
  const { c } = useTheme();
  return (
    <Press
      onPress={onPress}
      accessibilityLabel={label}
      style={{
        width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
        backgroundColor: tone === 'surface' ? c.surface : 'transparent', borderWidth: tone === 'surface' ? 1 : 0, borderColor: c.line,
      }}
    >
      <Icon name={icon} size={20} color={c.text} />
      {badge ? <View style={{ position: 'absolute', top: 9, end: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: c.amber, borderWidth: 2, borderColor: c.surface }} /> : null}
    </Press>
  );
}

// ---------- Inputs ----------

export function Toggle({ value, onChange, disabled, label, tone = 'mint' }: { value: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string; tone?: 'mint' | 'amber' }) {
  const { c } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: value ? 1 : 0, useNativeDriver: false, bounciness: 6, speed: 18 }).start();
  }, [anim, value]);
  const on = tone === 'amber' ? c.amber : c.mint;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => { tap(); onChange(!value); }}
      hitSlop={8}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Animated.View style={{
        width: 52, height: 32, borderRadius: 16, padding: 3, flexDirection: 'row',
        backgroundColor: anim.interpolate({ inputRange: [0, 1], outputRange: [c.surface2, on] }),
        borderWidth: 1, borderColor: anim.interpolate({ inputRange: [0, 1], outputRange: [c.line, on] }),
      }}>
        {/* RTL: off = knob on the right (start), on = knob on the left (end), as in the design. */}
        <Animated.View style={{
          width: 24, height: 24, borderRadius: 12,
          backgroundColor: anim.interpolate({ inputRange: [0, 1], outputRange: [c.muted, tone === 'amber' ? c.onAmber : c.onMint] }),
          marginStart: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }),
        }} />
      </Animated.View>
    </Pressable>
  );
}

export function Field({ label, hint, error, style, inputStyle, ltr, ...props }: TextInputProps & {
  label?: string; hint?: string; error?: string | null; style?: StyleProp<ViewStyle>; inputStyle?: StyleProp<TextStyle>; ltr?: boolean;
}) {
  const { c } = useTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Txt variant="bodySemi" style={{ fontSize: 14 }}>{label}</Txt> : null}
      <TextInput
        placeholderTextColor={c.faint}
        selectionColor={c.mint}
        {...props}
        onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
        style={[{
          minHeight: 52, borderRadius: 14, borderWidth: focused ? 1.5 : 1, borderColor: error ? c.danger : focused ? c.mint : c.line,
          backgroundColor: c.surface, color: c.text, paddingHorizontal: 14, paddingVertical: 12,
          fontFamily: fonts.body, fontSize: 16, textAlign: ltr ? 'left' : 'right', writingDirection: ltr ? 'ltr' : 'rtl',
        }, props.multiline ? { minHeight: 110, textAlignVertical: 'top' } : null, inputStyle]}
      />
      {error ? <Txt variant="caption" color={c.danger}>{error}</Txt> : hint ? <Txt variant="caption" color={c.muted}>{hint}</Txt> : null}
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder, autoFocus }: { value: string; onChangeText: (text: string) => void; placeholder: string; autoFocus?: boolean }) {
  const { c } = useTheme();
  return (
    <View style={[styles.row, { alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 16, borderRadius: 16, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }]}>
      <Icon name="search" size={20} color={c.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.faint}
        selectionColor={c.mint}
        autoFocus={autoFocus}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        style={{ flex: 1, height: 50, color: c.text, fontFamily: fonts.body, fontSize: 16, textAlign: 'right', writingDirection: 'rtl' }}
      />
      {value ? (
        <Pressable onPress={() => onChangeText('')} accessibilityLabel="ניקוי החיפוש" hitSlop={10}>
          <Icon name="x-circle" size={18} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon, tone = 'mint' }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName; tone?: 'mint' | 'amber' | 'plain' }) {
  const { c } = useTheme();
  const bg = selected ? (tone === 'amber' ? c.amber : c.mint) : tone === 'amber' ? c.amberChip : c.surface;
  const fg = selected ? (tone === 'amber' ? c.onAmber : c.onMint) : tone === 'amber' ? c.amberText : c.text;
  const content = (
    <>
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Txt variant="bodyMedium" color={fg} style={{ fontSize: 14 }}>{label}</Txt>
    </>
  );
  const style = [styles.row, { alignItems: 'center' as const, gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 12, backgroundColor: bg, borderWidth: 1, borderColor: selected ? bg : tone === 'amber' ? c.amberLine : c.line }];
  if (!onPress) return <View style={style}>{content}</View>;
  return <Press onPress={onPress} accessibilityState={{ selected }} style={style}>{content}</Press>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.row, { padding: 4, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => { tap(); onChange(option.value); }}
            style={{ flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? c.surface2 : 'transparent' }}
          >
            <Txt variant={selected ? 'bodySemi' : 'body'} color={selected ? c.text : c.muted} style={{ fontSize: 14 }}>{option.label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Lists ----------

export function ListGroup({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: 20, borderWidth: 1, borderColor: c.line, overflow: 'hidden' }}>
      {items.map((child, index) => (
        <View key={index} style={index < items.length - 1 ? { borderBottomWidth: 1, borderBottomColor: c.lineSoft } : undefined}>{child}</View>
      ))}
    </View>
  );
}

export function ListRow({ icon, iconTone = 'mint', title, subtitle, value, onPress, right, chevron = true, danger }: {
  icon?: IconName; iconTone?: 'mint' | 'amber' | 'muted' | 'danger'; title: string; subtitle?: string; value?: string;
  onPress?: () => void; right?: React.ReactNode; chevron?: boolean; danger?: boolean;
}) {
  const { c } = useTheme();
  const tones = {
    mint: { bg: c.surface2, fg: c.mint }, amber: { bg: c.amberBg, fg: c.amber },
    muted: { bg: c.surface2, fg: c.muted }, danger: { bg: c.dangerBg, fg: c.danger },
  };
  const content = (
    <View style={[styles.row, { alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, minHeight: 60 }]}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: tones[iconTone].bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={tones[iconTone].fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt variant="bodyMedium" color={danger ? c.danger : c.text} numberOfLines={2}>{title}</Txt>
        {subtitle ? <Txt variant="caption" color={c.muted} numberOfLines={2}>{subtitle}</Txt> : null}
      </View>
      {value ? <Txt variant="label" color={c.muted}>{value}</Txt> : null}
      {right}
      {onPress && chevron ? <Icon name="chevron-left" size={20} color={c.faint} /> : null}
    </View>
  );
  if (!onPress) return content;
  return <Press onPress={onPress} accessibilityLabel={title}>{content}</Press>;
}

// ---------- States ----------

export function EmptyState({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 20 }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={28} color={c.mint} />
      </View>
      <Txt variant="h3" center>{title}</Txt>
      {text ? <Txt variant="body" color={c.muted} center>{text}</Txt> : null}
      {action}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { c } = useTheme();
  return (
    <Card tone="danger" style={{ gap: 12 }}>
      <Row align="flex-start">
        <Icon name="alert-triangle" size={20} color={c.danger} />
        <Txt variant="bodyMedium" color={c.dangerText} style={{ flex: 1 }}>{message}</Txt>
      </Row>
      {onRetry ? <Button title="נסו שוב" icon="refresh-cw" variant="danger" size="md" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Skeleton({ height = 72, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[{ height, borderRadius: 20, backgroundColor: c.surface, opacity: pulse }, style]} />;
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function Pill({ label, tone = 'mint' }: { label: string; tone?: 'mint' | 'amber' | 'muted' | 'danger' }) {
  const { c } = useTheme();
  const tones = {
    mint: { bg: c.mintSoft, fg: c.mint }, amber: { bg: c.amberBg, fg: c.amber },
    muted: { bg: c.surface2, fg: c.muted }, danger: { bg: c.dangerBg, fg: c.danger },
  };
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8, backgroundColor: tones[tone].bg }}>
      <Txt variant="caption" color={tones[tone].fg} style={{ fontFamily: fonts.bodySemi }}>{label}</Txt>
    </View>
  );
}

// ---------- Sheet (bottom modal) ----------

export function Sheet({ visible, onClose, title, children, footer }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel="סגירה" />
        <View style={{ flex: 1 }} pointerEvents="box-none" />
        <View style={{ direction: 'rtl', maxHeight: '88%', backgroundColor: c.bg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: c.line, paddingBottom: Math.max(insets.bottom, 12) }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: c.line }} />
          </View>
          <Row style={{ justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
            <Txt variant="h2" style={{ flex: 1 }}>{title}</Txt>
            <IconButton icon="x" label="סגירה" onPress={onClose} tone="plain" />
          </Row>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? <View style={[styles.row, { gap: 10, paddingHorizontal: 20, paddingTop: 8 }]}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, direction: 'rtl' },
  row: { flexDirection: 'row' },
});
