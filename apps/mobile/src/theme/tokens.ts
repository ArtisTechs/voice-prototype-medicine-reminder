// Design tokens (see .claude/skills/ui-ux). Every color pair is WCAG AA checked; do not invent colors.

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const minTouch = 48;

export const type = {
  caption: { fontSize: 14, lineHeight: 20 },
  body: { fontSize: 17, lineHeight: 24 },
  bodyStrong: { fontSize: 17, lineHeight: 24, fontWeight: '600' as const },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '600' as const },
  headline: { fontSize: 24, lineHeight: 32, fontWeight: '700' as const },
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' as const },
} as const;
export type TypeVariant = keyof typeof type;

const light = {
  bg: '#F3F5F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EBEFF5',
  border: '#C4CBD6',
  text: '#121826',
  textMuted: '#4A5466',
  primary: '#02547A',
  primarySoft: '#E1F0F8',
  onPrimary: '#FFFFFF',
  accent: '#0A6B5C',
  accentSoft: '#DDF3EE',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  focus: '#02547A',
  skeleton: '#E1E6EE',
  shadow: '#1B2A4A',
};

const dark: typeof light = {
  bg: '#0E1117',
  surface: '#171B24',
  surfaceAlt: '#212734',
  border: '#394152',
  text: '#F1F3F7',
  textMuted: '#B3BBCA',
  primary: '#8FD3F4',
  primarySoft: '#0F3347',
  onPrimary: '#032C40',
  accent: '#6ED9C4',
  accentSoft: '#12302B',
  danger: '#FF8A80',
  onDanger: '#3B1412',
  focus: '#8FD3F4',
  skeleton: '#262C38',
  shadow: '#000000',
};

export const palettes = { light, dark };
export type Palette = typeof light;

export type Status =
  | 'taken'
  | 'late'
  | 'due'
  | 'upcoming'
  | 'missed'
  | 'expired'
  | 'lowStock'
  | 'online'
  | 'offline';

type StatusStyle = { word: string; icon: string; fg: string; bg: string };

export const statusTokens: Record<'light' | 'dark', Record<Status, StatusStyle>> = {
  light: {
    taken: { word: 'Taken', icon: 'checkmark-circle', fg: '#1B6E2D', bg: '#E3F4E6' },
    late: { word: 'Taken late', icon: 'time', fg: '#1B6E2D', bg: '#E3F4E6' },
    due: { word: 'Due now', icon: 'alarm', fg: '#8A5300', bg: '#FFF1D6' },
    upcoming: { word: 'Upcoming', icon: 'ellipse-outline', fg: '#3D4451', bg: '#EEF0F3' },
    missed: { word: 'Missed', icon: 'close-circle', fg: '#B3261E', bg: '#FDE7E5' },
    expired: { word: 'Expired', icon: 'warning', fg: '#7B1FA2', bg: '#F3E5F7' },
    lowStock: { word: 'Low stock', icon: 'cube', fg: '#A04500', bg: '#FFE9D9' },
    online: { word: 'Online', icon: 'wifi', fg: '#1B6E2D', bg: '#E3F4E6' },
    offline: { word: 'Offline', icon: 'cloud-offline', fg: '#B3261E', bg: '#FDE7E5' },
  },
  dark: {
    taken: { word: 'Taken', icon: 'checkmark-circle', fg: '#7DDB8F', bg: '#12321A' },
    late: { word: 'Taken late', icon: 'time', fg: '#7DDB8F', bg: '#12321A' },
    due: { word: 'Due now', icon: 'alarm', fg: '#FFC766', bg: '#3A2A06' },
    upcoming: { word: 'Upcoming', icon: 'ellipse-outline', fg: '#C5CAD3', bg: '#262A31' },
    missed: { word: 'Missed', icon: 'close-circle', fg: '#FF8A80', bg: '#3B1412' },
    expired: { word: 'Expired', icon: 'warning', fg: '#E1A6F0', bg: '#33163D' },
    lowStock: { word: 'Low stock', icon: 'cube', fg: '#FFB27A', bg: '#3A2210' },
    online: { word: 'Online', icon: 'wifi', fg: '#7DDB8F', bg: '#12321A' },
    offline: { word: 'Offline', icon: 'cloud-offline', fg: '#FF8A80', bg: '#3B1412' },
  },
};
