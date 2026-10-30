import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { minTouch, spacing } from '../theme/tokens';
import { AppText } from './AppText';

type Props = { label: string; description?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean };

/** The whole row toggles (big target); the word On/Off is shown, not only the switch colour. */
export function SwitchRow({ label, description, value, onChange, disabled }: Props) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.row}
    >
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? <AppText muted>{description}</AppText> : null}
      </View>
      <AppText variant="bodyStrong" color={value ? colors.primary : colors.textMuted}>
        {value ? 'On' : 'Off'}
      </AppText>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primary, false: colors.border }}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: minTouch + 8, paddingVertical: spacing.xs },
  text: { flex: 1, gap: 2 },
});
