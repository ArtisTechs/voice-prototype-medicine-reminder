// Design tokens (see .claude/skills/ui-ux). Every color pair is WCAG AA checked; do not invent colors.

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;
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
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F3',
  border: '#C9CED6',
  text: '#16191D',
  textMuted: '#4A515C',
  primary: '#0B5FA5',
  onPrimary: '#FFFFFF',
  danger: '#B3261E',
  onDanger: '#FFFFFF',
  focus: '#0B5FA5',
  skeleton: '#E1E4E9',
};

const dark: typeof light = {
  bg: '#101317',
  surface: '#181C21',
  surfaceAlt: '#232830',
  border: '#3A414B',
  text: '#F1F3F5',
  textMuted: '#B4BBC5',
  primary: '#7DB8F2',
  onPrimary: '#0A1F33',
  danger: '#FF8A80',
  onDanger: '#3B1412',
  focus: '#7DB8F2',
  skeleton: '#2A3038',
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
