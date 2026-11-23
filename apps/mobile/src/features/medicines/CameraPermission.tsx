import { useCameraPermissions } from 'expo-camera';
import { useEffect } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { spacing } from '../../theme/tokens';

/** Camera permission that also notices when the person comes back from the phone's Settings with it switched on. */
export function useCameraAccess() {
  const [permission, request, refresh] = useCameraPermissions();
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { permission, request };
}

/** Explains why the camera is needed and offers the right next step: ask, or open Settings when it was refused for good. */
export function CameraPermissionNotice({ reason, canAskAgain, onAllow }: { reason: string; canAskAgain: boolean; onAllow: () => void }) {
  return (
    <View style={styles.center}>
      <AppText>{reason}</AppText>
      {canAskAgain ? (
        <Button title="Allow camera" icon="camera" onPress={onAllow} />
      ) : (
        <>
          <AppText muted>The camera is turned off for MIRA. Turn it on in your phone's settings, then come back here.</AppText>
          <Button title="Open phone settings" icon="settings" onPress={() => Linking.openSettings()} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' },
});
