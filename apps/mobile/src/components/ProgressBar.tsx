import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { AppText } from './AppText';

/** Progress always comes with words ("3 of 5 taken"), never the bar alone. */
export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const { colors, status } = useTheme();
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: done }}
      style={styles.wrap}
    >
      <AppText variant="bodyStrong">{label}</AppText>
      <View style={[styles.track, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: status.taken.fg }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  track: { height: 12, borderRadius: radius.sm, borderWidth: 1, overflow: 'hidden' },
  fill: { height: '100%' },
});
