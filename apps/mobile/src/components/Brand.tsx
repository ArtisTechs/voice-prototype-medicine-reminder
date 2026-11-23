import { Image, StyleSheet, View } from 'react-native';

import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';

/** MIRA logo (same art as the app icon, from tools/icons) + tagline for sign-in and sign-up. */
export function Brand({ tagline }: { tagline: string }) {
  return (
    <View style={styles.wrap} accessible accessibilityRole="header" accessibilityLabel={`MIRA. ${tagline}`}>
      <Image source={require('../../assets/icon.png')} style={styles.logo} />
      <AppText variant="display" style={styles.name}>
        MIRA
      </AppText>
      <AppText muted style={styles.center}>
        {tagline}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  logo: { width: 88, height: 88, borderRadius: radius.xl },
  name: { letterSpacing: 4 },
  center: { textAlign: 'center' },
});
