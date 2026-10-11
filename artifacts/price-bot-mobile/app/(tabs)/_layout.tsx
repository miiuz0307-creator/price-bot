import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '@/components/Icon';
import { tap, Txt } from '@/components/ui';
import { fonts } from '@/constants/theme';
import { usePendingRequests } from '@/lib/queries';
import { useTheme } from '@/lib/theme';

type BottomTabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const tabs: Record<string, { title: string; icon: IconName }> = {
  index: { title: 'בית', icon: 'home' },
  prices: { title: 'מחירון', icon: 'tag' },
  requests: { title: 'בקשות', icon: 'inbox' },
  surge: { title: 'עומס', icon: 'flame' },
  more: { title: 'עוד', icon: 'grid' },
};

/** Bottom navigation from the approved design (first tab on the right). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const pending = usePendingRequests().data?.length ?? 0;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row', direction: 'rtl', backgroundColor: c.nav, borderTopWidth: 1, borderTopColor: c.lineSoft,
        paddingTop: 8, paddingHorizontal: 10, paddingBottom: Math.max(insets.bottom, 10) + (Platform.OS === 'ios' ? 0 : 6),
      }}
    >
      {state.routes.map((route, index) => {
        const tab = tabs[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        const color = focused ? c.mint : c.muted;
        const badge = route.name === 'requests' && pending > 0 ? pending : 0;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${tab.title}, ${badge} ממתינות` : tab.title}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) { tap(); navigation.navigate(route.name); }
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 52 }}
          >
            <View style={{ width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? c.mintSoft : 'transparent' }}>
              <Icon name={tab.icon} size={22} color={color} strokeWidth={focused ? 2.1 : 1.8} />
              {badge ? (
                <View style={{ position: 'absolute', top: -4, end: 4, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: c.amber, alignItems: 'center', justifyContent: 'center' }}>
                  <Txt variant="caption" color={c.onAmber} style={{ fontFamily: fonts.bodySemi, fontSize: 11, lineHeight: 14 }} center>{badge > 99 ? '99+' : badge}</Txt>
                </View>
              ) : null}
            </View>
            <Txt variant="caption" color={color} center style={{ fontFamily: focused ? fonts.bodySemi : fonts.bodyMedium, fontSize: 11, lineHeight: 14 }}>{tab.title}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { c } = useTheme();
  return (
    <Tabs backBehavior="history" tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: c.bg }, animation: 'shift' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="prices" />
      <Tabs.Screen name="requests" />
      <Tabs.Screen name="surge" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
