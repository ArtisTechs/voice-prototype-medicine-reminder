import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing, type Status } from '../theme/tokens';
import { AppText } from './AppText';

type Props = { status: Status; label?: string };

/** Status is always icon + word (+ color). Never color alone. */
export function StatusBadge({ status, label }: Props) {
  const { status: tokens } = useTheme();
  const t = tokens[status];
  const word = label ?? t.word;
  return (
    <View
      accessible
      accessibilityLabel={word}
      testID={`status-${status}`}
      style={[styles.badge, { backgroundColor: t.bg, borderColor: t.fg }]}
    >
      <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={18} color={t.fg} testID={`status-icon-${status}`} />
      <AppText variant="bodyStrong" color={t.fg}>
        {word}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
});
