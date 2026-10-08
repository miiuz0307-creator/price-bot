import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export default function TabLayout() {
  const colors = useColors();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.mutedForeground,
      tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, height: Platform.OS === 'web' ? 84 : undefined },
      tabBarLabelStyle: { fontFamily: 'Inter_500Medium', fontSize: 11 },
    }}>
      <Tabs.Screen name="index" options={{ title: 'סקירה', tabBarIcon: ({ color }) => <Feather name="grid" size={21} color={color} /> }} />
      <Tabs.Screen name="products" options={{ title: 'מחירים', tabBarIcon: ({ color }) => <Feather name="tag" size={21} color={color} /> }} />
      <Tabs.Screen name="targets" options={{ title: 'יעדים', tabBarIcon: ({ color }) => <Feather name="message-circle" size={21} color={color} /> }} />
      <Tabs.Screen name="admins" options={{ title: 'מנהלים', tabBarIcon: ({ color }) => <Feather name="users" size={21} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'חיבור', tabBarIcon: ({ color }) => <Feather name="settings" size={21} color={color} /> }} />
    </Tabs>
  );
}