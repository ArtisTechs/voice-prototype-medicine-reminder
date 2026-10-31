import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  style?: ViewStyle;
  /** "tinted" uses the soft primary background, for highlights like "Next dose". */
  tone?: 'default' | 'tinted';
};

/** Rounded surface: soft shadow in light mode, hairline border in dark mode (shadows vanish there). */
export function Card({ children, onPress, accessibilityLabel, style, tone = 'default' }: Props) {
  const { colors, scheme } = useTheme();
  const base = [
    styles.card,
    {
      backgroundColor: tone === 'tinted' ? colors.primarySoft : colors.surface,
      borderColor: scheme === 'dark' ? colors.border : 'transparent',
      shadowColor: colors.shadow,
    },
    scheme === 'light' && tone === 'default' ? styles.shadow : null,
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [...base, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  shadow: { shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
});
