import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { spacing } from '../theme/tokens';
import { AppText } from './AppText';

type Tone = 'primary' | 'accent' | 'taken' | 'due' | 'missed' | 'expired' | 'lowStock' | 'neutral';

function useTone(tone: Tone): { fg: string; bg: string } {
  const { colors, status } = useTheme();
  switch (tone) {
    case 'primary':
      return { fg: colors.primary, bg: colors.primarySoft };
    case 'accent':
      return { fg: colors.accent, bg: colors.accentSoft };
    case 'neutral':
      return { fg: colors.textMuted, bg: colors.surfaceAlt };
    default:
      return status[tone];
  }
}

/** Icon on a soft rounded square. Decorative: the text next to it carries the meaning. */
export function IconCircle({ icon, tone = 'primary', size = 44 }: { icon: keyof typeof Ionicons.glyphMap; tone?: Tone; size?: number }) {
  const t = useTone(tone);
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.circle, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: t.bg }]}
    >
      <Ionicons name={icon} size={size * 0.52} color={t.fg} />
    </View>
  );
}

/** Initials avatar for a person. */
export function Avatar({ name, size = 52 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary }]}
    >
      <AppText variant="title" color={colors.onPrimary}>
        {initials || '?'}
      </AppText>
    </View>
  );
}

/** Section title with an optional action on the right. */
export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.section}>
      <AppText variant="title" style={styles.flex}>
        {title}
      </AppText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  section: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  flex: { flex: 1 },
});

