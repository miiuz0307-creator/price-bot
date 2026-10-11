import React from 'react';
import { View } from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/ui';
import { useTheme } from '@/lib/theme';

export function FeedRow({ icon, tone, title, subtitle, time, last }: {
  icon: IconName; tone: 'mint' | 'amber' | 'muted' | 'danger'; title: string; subtitle?: string; time: string; last: boolean;
}) {
  const { c } = useTheme();
  const tones = { mint: [c.surface2, c.mint], amber: [c.amberBg, c.amber], muted: [c.surface2, c.muted], danger: [c.dangerBg, c.danger] };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.lineSoft }}>
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: tones[tone][0], alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color={tones[tone][1]} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt variant="bodyMedium" style={{ fontSize: 14 }} numberOfLines={1}>{title}</Txt>
        {subtitle ? <Txt variant="caption" color={c.muted} numberOfLines={1}>{subtitle}</Txt> : null}
      </View>
      <Txt variant="caption" color={c.muted}>{time}</Txt>
    </View>
  );
}
