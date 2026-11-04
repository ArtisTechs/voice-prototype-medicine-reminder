import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { api } from '../../api/client';
import type { Page, Scan } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { errorMessage } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

export type PackageRead = { name: string; strength: string | null; expiry: string | null; guessed: boolean };

type Phase = 'waiting' | 'unreadable' | 'timeout' | 'error';

const POLL_MS = 2000;
const GIVE_UP_MS = 170_000; // the server waits 3 minutes

/**
 * Add a medicine by scanning it on the VOICE: asks the server to read the next package the person's VOICE sees,
 * then waits for that scan to appear and hands back what was printed on the box.
 */
export function VoiceScanSheet({ visible, patientId, onClose, onRead }: { visible: boolean; patientId: number; onClose: () => void; onRead: (r: PackageRead) => void }) {
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('waiting');
  const [message, setMessage] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const newest = useCallback(
    async () => (await api<Page<Scan>>(`/api/v1/patients/${patientId}/scans`, { query: { limit: 1 } })).items[0] ?? null,
    [patientId],
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setPhase('waiting');
    setMessage(null);

    (async () => {
      try {
        // Scans that already exist do not count: only a scan made after we start waiting.
        const baseline = (await newest())?.id ?? 0;
        await api(`/api/v1/patients/${patientId}/scans/learn`, { method: 'POST' });
        const startedAt = Date.now();
        const poll = async () => {
          if (cancelled) return;
          try {
            const latest = await newest();
            if (latest && latest.id > baseline) {
              if (latest.readName) {
                onReadRef.current({ name: latest.readName, strength: latest.readStrength, expiry: latest.ocrExpiry, guessed: latest.guessed });
              } else {
                setPhase('unreadable');
              }
              return;
            }
          } catch {
            /* a dropped request: try again on the next tick */
          }
          if (Date.now() - startedAt > GIVE_UP_MS) {
            setPhase('timeout');
            return;
          }
          timer = setTimeout(poll, POLL_MS);
        };
        timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (!cancelled) {
          setMessage(errorMessage(e));
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [visible, round, patientId, newest]);

  const again = () => setRound((r) => r + 1);
  const failed = phase !== 'waiting';

  return (
    <Sheet visible={visible} title="Scan with VOICE" onClose={onClose}>
      <View style={styles.center} accessibilityLiveRegion="polite">
        {failed ? (
          <Ionicons name={phase === 'error' ? 'alert-circle' : 'help-circle'} size={56} color={colors.danger} />
        ) : (
          <ActivityIndicator size="large" color={colors.primary} />
        )}
        <AppText variant="title" style={styles.text}>
          {phase === 'waiting' && 'Waiting for your VOICE…'}
          {phase === 'unreadable' && "VOICE couldn't read that box"}
          {phase === 'timeout' && 'Nothing came from your VOICE'}
          {phase === 'error' && "We couldn't start"}
        </AppText>
        {phase === 'waiting' ? (
          <AppText muted style={styles.text}>
            1. Hold the medicine box in front of the VOICE camera.{'\n'}2. Press the scan button on the VOICE.
          </AppText>
        ) : null}
        {phase === 'unreadable' ? (
          <AppText muted style={styles.text}>
            Hold the side of the box with the name printed on it, in good light, and try again.
          </AppText>
        ) : null}
        {phase === 'timeout' ? (
          <AppText muted style={styles.text}>
            Check that the VOICE is on and connected to WiFi, then try again.
          </AppText>
        ) : null}
        {phase === 'error' ? (
          <AppText muted style={styles.text}>
            {message}
          </AppText>
        ) : null}
      </View>
      {failed ? <Button title="Try again" icon="refresh" onPress={again} /> : null}
      <Button title={failed ? 'Close' : 'Cancel'} variant="secondary" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  text: { textAlign: 'center' },
});
