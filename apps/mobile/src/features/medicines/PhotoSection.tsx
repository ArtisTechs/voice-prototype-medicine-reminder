import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { usePhotoMutations, usePhotos } from '../../api/hooks';
import { AppText } from '../../components/AppText';
import { AuthImage } from '../../components/AuthImage';
import { Button } from '../../components/Button';
import { Banner, Skeleton, errorMessage } from '../../components/States';
import { radius, spacing } from '../../theme/tokens';
import { PhotoCaptureModal } from './PhotoCaptureModal';

const ANGLES = [
  { value: 'front', label: 'Front' },
  { value: 'back', label: 'Back' },
  { value: 'side', label: 'Side' },
] as const;

const ANGLE_WORD: Record<string, string> = { front: 'Front', back: 'Back', side: 'Side', correction: 'From a scan', other: 'Other' };

/** Reference photos of the package; the pillbox camera compares scans against these. */
export function PhotoSection({ pid, mid }: { pid: number; mid: number }) {
  const photos = usePhotos(pid, mid);
  const m = usePhotoMutations(pid, mid);
  const [angle, setAngle] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (uri: string) => {
    const a = angle ?? 'front';
    setAngle(null);
    setError(null);
    try {
      await m.upload.mutateAsync({ uri, angle: a });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <AppText variant="title">Package photos</AppText>
      <AppText muted>Take the front, back and side of the box. This helps the VOICE camera recognise it.</AppText>
      {error ? <Banner tone="error" message={error} /> : null}
      {photos.isPending ? (
        <Skeleton height={120} />
      ) : photos.isError ? (
        <Banner tone="error" message={errorMessage(photos.error)} />
      ) : photos.data.length === 0 ? (
        <AppText muted>No photos yet.</AppText>
      ) : (
        <View style={styles.grid}>
          {photos.data.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityLabel={`${ANGLE_WORD[p.angle]} photo. Double tap to remove.`}
              onPress={() =>
                Alert.alert('Remove this photo?', undefined, [
                  { text: 'Keep it', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => m.remove.mutate(p.id) },
                ])
              }
              style={styles.thumbWrap}
            >
              <AuthImage path={p.url} style={styles.thumb} label={`${ANGLE_WORD[p.angle]} photo`} />
              <AppText variant="caption">{ANGLE_WORD[p.angle]}</AppText>
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.row}>
        {ANGLES.map((a) => (
          <Button
            key={a.value}
            title={a.label}
            icon="camera"
            variant="secondary"
            onPress={() => setAngle(a.value)}
            style={styles.flex}
            loading={m.upload.isPending && m.upload.variables?.angle === a.value}
          />
        ))}
      </View>
      <PhotoCaptureModal visible={angle !== null} angle={angle ?? 'front'} onClose={() => setAngle(null)} onCaptured={upload} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { gap: 2, alignItems: 'center' },
  thumb: { width: 100, height: 75, borderRadius: radius.sm },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flexGrow: 1 },
});
