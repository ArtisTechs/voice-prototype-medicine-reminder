import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { minTouch, spacing } from '../theme/tokens';
import { AppText } from './AppText';

type Props = {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  right?: ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
};

export function ListItem({ title, subtitle, icon, right, onPress, accessibilityHint }: Props) {
  const { colors } = useTheme();
  const body = (
    <View style={styles.row}>
      {icon ? <Ionicons name={icon} size={24} color={colors.primary} /> : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong">{title}</AppText>
        {subtitle ? <AppText muted>{subtitle}</AppText> : null}
      </View>
      {right}
      {onPress ? <Ionicons name="chevron-forward" size={22} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch + 8, paddingVertical: spacing.sm },
  text: { flex: 1, gap: 2 },
});
