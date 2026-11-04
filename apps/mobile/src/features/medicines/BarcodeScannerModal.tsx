import { CameraView } from 'expo-camera';
import { useRef } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { CameraPermissionNotice, useCameraAccess } from './CameraPermission';

type Props = { visible: boolean; onClose: () => void; onScanned: (code: string) => void };

/** Phone-camera barcode scan for the medicine form, with a "type it instead" way out. */
export function BarcodeScannerModal({ visible, onClose, onScanned }: Props) {
  const { permission, request: requestPermission } = useCameraAccess();
  const done = useRef(false);
  const { colors } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => {
        done.current = false;
      }}>
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <AppText variant="title">Scan the barcode</AppText>
          <AppText muted>Hold the box steady so the barcode fills the frame.</AppText>
        </View>
        {!permission ? null : !permission.granted ? (
          <CameraPermissionNotice
            reason="The camera is needed to scan. You can also type the number printed under the barcode."
            canAskAgain={permission.canAskAgain}
            onAllow={requestPermission}
          />
        ) : visible ? (
          <CameraView
            style={styles.flex}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={({ data }) => {
              if (done.current || !data) return;
              done.current = true;
              onScanned(data.trim());
            }}
          />
        ) : null}
        <View style={styles.footer}>
          <Button title="Type it instead" variant="secondary" icon="create" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: spacing.lg, gap: spacing.xs },
  center: { flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' },
  footer: { padding: spacing.lg },
});
