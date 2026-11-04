import { CameraView } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRef, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import { CameraPermissionNotice, useCameraAccess } from './CameraPermission';

const ANGLE_WORDS: Record<string, string> = { front: 'front', back: 'back', side: 'side' };

type Props = {
  visible: boolean;
  angle: string;
  onClose: () => void;
  onCaptured: (uri: string) => void;
  /** Replace the heading and hint (used when the photo is only read, not kept). */
  title?: string;
  hint?: string;
};

/** Reference photo of the medicine package; resized to <=1280 px before upload. */
export function PhotoCaptureModal({ visible, angle, onClose, onCaptured, title, hint }: Props) {
  const { permission, request: requestPermission } = useCameraAccess();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const camera = useRef<CameraView>(null);
  const { colors } = useTheme();

  const shoot = async () => {
    if (!camera.current) return;
    setBusy(true);
    setFailed(false);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: true });
      if (!photo) return;
      const rendered = await ImageManipulator.manipulate(photo.uri).resize({ width: 1280 }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      onCaptured(saved.uri);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setReady(false)}>
      <SafeAreaView style={[styles.flex, { backgroundColor: colors.bg }]}>
        <View style={styles.header}>
          <AppText variant="title">{title ?? `Photo of the ${ANGLE_WORDS[angle] ?? 'box'}`}</AppText>
          <AppText muted>{hint ?? 'Good light, box fills the frame, name easy to read. The VOICE camera uses these to recognise the box.'}</AppText>
        </View>
        {!permission ? null : !permission.granted ? (
          <CameraPermissionNotice reason="The camera is needed to take package photos." canAskAgain={permission.canAskAgain} onAllow={requestPermission} />
        ) : visible ? (
          <CameraView ref={camera} style={styles.flex} facing="back" onCameraReady={() => setReady(true)} />
        ) : null}
        {failed ? <AppText style={styles.header} accessibilityLiveRegion="polite">The photo didn't work. Try once more.</AppText> : null}
        <View style={styles.footer}>
          <Button title="Take photo" icon="camera" onPress={shoot} loading={busy} disabled={!ready} />
          <Button title="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { padding: spacing.lg, gap: spacing.xs },
  center: { flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'center' },
  footer: { padding: spacing.lg, gap: spacing.sm },
});
