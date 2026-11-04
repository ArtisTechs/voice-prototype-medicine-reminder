import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api } from '../../api/client';
import { ApiError } from '../../lib/apiError';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { errorMessage } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';
import type { PackageRead } from './VoiceScanSheet';

type Reply = { read: boolean; name: string | null; strength: string | null; expiry: string | null; guessed: boolean; reason: string | null };

/** Sends the phone's photo of a box to be read, and waits. Shows what went wrong in plain words. */
export function PhotoReadSheet({
  uri,
  patientId,
  onClose,
  onRetake,
  onRead,
}: {
  uri: string | null;
  patientId: number;
  onClose: () => void;
  onRetake: () => void;
  onRead: (r: PackageRead) => void;
}) {
  const { colors } = useTheme();
  const [problem, setProblem] = useState<string | null>(null);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    setProblem(null);
    (async () => {
      try {
        const send = () => {
          // A new FormData each time: a body that was already sent cannot be reused.
          const form = new FormData();
          form.append('file', { uri, name: 'box.jpg', type: 'image/jpeg' } as unknown as Blob);
          return api<Reply>(`/api/v1/patients/${patientId}/medicines/read-package`, { method: 'POST', body: form, timeoutMs: 60000 });
        };
        let r: Reply;
        try {
          r = await send();
        } catch (e) {
          // Reading stores nothing, so it is safe to try again once: the server may have been asleep or restarting.
          if (!(e instanceof ApiError && e.code === 'network')) throw e;
          await new Promise((resolve) => setTimeout(resolve, 4000));
          if (cancelled) return;
          r = await send();
        }
        if (cancelled) return;
        if (r.read && r.name) onReadRef.current({ name: r.name, strength: r.strength, expiry: r.expiry, guessed: r.guessed });
        else if (r.reason === 'rate_limited' || r.reason === 'local_rate_limit') setProblem('The reader is busy right now. Wait a minute and try again.');
        else if (r.reason === 'no_key') setProblem('Reading boxes is not switched on for this server yet.');
        else setProblem("We couldn't read that box. Hold the side with the name printed on it, in good light, and try again.");
      } catch (e) {
        if (!cancelled) setProblem(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, patientId]);

  return (
    <Sheet visible={!!uri} title="Reading the box" onClose={onClose}>
      <View style={styles.center} accessibilityLiveRegion="polite">
        {problem ? <Ionicons name="help-circle" size={56} color={colors.danger} /> : <ActivityIndicator size="large" color={colors.primary} />}
        <AppText variant="title" style={styles.text}>
          {problem ? "Couldn't read it" : 'Reading the box…'}
        </AppText>
        <AppText muted style={styles.text}>
          {problem ?? 'This can take up to 10 seconds.'}
        </AppText>
      </View>
      {problem ? <Button title="Take another photo" icon="camera" onPress={onRetake} /> : null}
      <Button title={problem ? 'Close' : 'Cancel'} variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  text: { textAlign: 'center' },
});
