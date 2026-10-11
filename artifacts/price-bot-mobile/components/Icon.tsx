import React from 'react';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

type FeatherName = React.ComponentProps<typeof Feather>['name'];
export type IconName = FeatherName | 'flame' | 'whatsapp';

/** Feather (same family as the website's Lucide icons) + two brand-specific shapes. */
export function Icon({ name, size = 22, color, strokeWidth = 2 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  if (name === 'flame' || name === 'whatsapp') {
    const d = name === 'flame'
      ? 'M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z'
      : 'M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5z';
    return (
      <Svg width={size} height={size} viewBox={name === 'flame' ? '3 1 18 18' : '0 0 24 24'} fill="none">
        <Path d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    );
  }
  return <Feather name={name} size={size} color={color} />;
}
