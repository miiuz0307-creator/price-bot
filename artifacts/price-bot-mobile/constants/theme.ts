/** Design tokens of the mobile app (approved design: green & black, Rubik + Heebo). */
export type Palette = {
  scheme: 'dark' | 'light';
  bg: string; surface: string; surface2: string; line: string; lineSoft: string; nav: string;
  text: string; muted: string; faint: string;
  mint: string; onMint: string; mintSoft: string; mintLine: string; mintTint: string;
  amber: string; onAmber: string; amberBg: string; amberLine: string; amberText: string; amberSub: string; amberChip: string;
  danger: string; dangerBg: string; dangerLine: string; dangerText: string; dangerSub: string;
  overlay: string;
};

export const dark: Palette = {
  scheme: 'dark',
  bg: '#0A1311', surface: '#111E1A', surface2: '#172823', line: '#22352F', lineSoft: '#1B2C27', nav: '#0E1916',
  text: '#EEF4F1', muted: '#93A8A0', faint: '#5E7069',
  mint: '#3DDC97', onMint: '#062016', mintSoft: '#173A2C', mintLine: '#1F4A39', mintTint: '#12261F',
  amber: '#F5B544', onAmber: '#1A1206', amberBg: '#2A2111', amberLine: '#5A4417', amberText: '#F5D9A0', amberSub: '#E9C98A', amberChip: '#3A2D14',
  danger: '#FF6B5E', dangerBg: '#2A1615', dangerLine: '#5A2522', dangerText: '#FFD0CB', dangerSub: '#E8A9A2',
  overlay: 'rgba(0,0,0,0.6)',
};

export const light: Palette = {
  scheme: 'light',
  bg: '#F3F6F4', surface: '#FFFFFF', surface2: '#EAF0EC', line: '#D9E3DD', lineSoft: '#E6ECE8', nav: '#FFFFFF',
  text: '#0C1A16', muted: '#5B6E66', faint: '#94A49D',
  mint: '#14A564', onMint: '#FFFFFF', mintSoft: '#DDF4E8', mintLine: '#A9E2C5', mintTint: '#EAF8F0',
  amber: '#B7791F', onAmber: '#FFFFFF', amberBg: '#FFF5E0', amberLine: '#F0D49A', amberText: '#7A4E0E', amberSub: '#94661E', amberChip: '#FBE6BA',
  danger: '#D33B2C', dangerBg: '#FDECEA', dangerLine: '#F4C3BD', dangerText: '#8E1F14', dangerSub: '#A8463B',
  overlay: 'rgba(12,26,22,0.45)',
};

export const fonts = {
  body: 'Heebo_400Regular',
  bodyMedium: 'Heebo_500Medium',
  bodySemi: 'Heebo_600SemiBold',
  head: 'Rubik_700Bold',
  headSemi: 'Rubik_600SemiBold',
  headMedium: 'Rubik_500Medium',
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 20, xxl: 24 };
