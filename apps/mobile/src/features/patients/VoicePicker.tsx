import { ActivityIndicator, StyleSheet, View } from 'react-native';

import type { NearbyDevice } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { StatusBadge } from '../../components/StatusBadge';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

export function describe(d: NearbyDevice): string {
  if (!d.paired) return 'New VOICE, ready to connect';
  const who = d.people === 1 ? '1 person on it' : `${d.people} people on it`;
  return d.mine ? `${who}, including someone you look after` : who;
}

type Props = {
  devices: NearbyDevice[] | undefined;
  /** The VOICE the person is on now, left out of the list. */
  currentId?: string;
  selectedId?: string | null;
  pendingId?: string | null;
  actionLabel: string;
  onPick: (deviceId: string) => void;
};

/** VOICEs found on the network (they show up by themselves within a minute) to tap and connect. */
export function VoicePicker({ devices, currentId, selectedId, pendingId, actionLabel, onPick }: Props) {
  const { colors } = useTheme();
  const list = (devices ?? []).filter((d) => d.deviceId !== currentId);
  if (!list.length) {
    return (
      <Card>
        <View style={styles.row}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Looking for VOICE" />
          <AppText variant="bodyStrong" style={styles.flex}>
            Looking for VOICE…
          </AppText>
        </View>
        <AppText muted>Switch VOICE on and connect it to the same WiFi. It shows up here by itself within a minute.</AppText>
      </Card>
    );
  }
  return (
    <>
      {list.map((d) => {
        const selected = selectedId === d.deviceId;
        return (
          <Card key={d.deviceId} tone={selected ? 'tinted' : 'default'}>
            <View style={styles.row}>
              <AppText variant="title" style={styles.flex}>
                {d.deviceId}
              </AppText>
              <StatusBadge status={d.status} />
            </View>
            <AppText>{describe(d)}</AppText>
            {d.paired && !d.mine ? (
              <AppText muted>Medicines of people you don't look after stay private.</AppText>
            ) : null}
            <Button
              title={selected ? 'Selected' : actionLabel}
              icon={selected ? 'checkmark-circle' : 'link'}
              variant={selected ? 'secondary' : 'primary'}
              loading={pendingId === d.deviceId}
              disabled={!!pendingId && pendingId !== d.deviceId}
              onPress={() => onPick(d.deviceId)}
            />
          </Card>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
