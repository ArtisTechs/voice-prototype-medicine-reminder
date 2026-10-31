import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { useDevice, usePairDevice, useUnpairDevice } from '../../../../api/hooks';
import { AppText } from '../../../../components/AppText';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { Banner, CardSkeleton, ErrorState } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { applyServerErrors, FormTextField } from '../../../../features/forms';
import { ApiError } from '../../../../lib/apiError';
import { ago } from '../../../../lib/format';
import { spacing } from '../../../../theme/tokens';

const code = z
  .string()
  .trim()
  .min(2, 'Enter the code shown on VOICE.')
  .max(32, 'Use 32 characters or fewer.')
  .regex(/^[A-Za-z0-9_-]+$/, 'Use only letters, numbers, - or _.');
const schema = z.object({ deviceId: code, cameraId: z.union([code, z.literal('')]) });
type Values = z.infer<typeof schema>;

function PairForm({ pid, initial }: { pid: number; initial?: Values }) {
  const pair = usePairDevice(pid);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { deviceId: 'pillbox', cameraId: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await pair.mutateAsync({ deviceId: v.deviceId.trim(), cameraId: v.cameraId.trim() || null });
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { deviceId: 'deviceId', cameraId: 'cameraId' }, { device_taken: 'deviceId' }));
    }
  });
  return (
    <Card>
      <AppText variant="title">Pair VOICE</AppText>
      <AppText>Type the VOICE code. The demo VOICE uses “pillbox”.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField control={control} name="deviceId" label="VOICE code" autoCapitalize="none" autoCorrect={false} />
      <FormTextField
        control={control}
        name="cameraId"
        label="Camera code (optional)"
        helper="Leave empty to use the VOICE code + “-cam”."
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button title="Pair VOICE" icon="link" onPress={() => onSubmit()} loading={pair.isPending} />
    </Card>
  );
}

export default function DeviceScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const q = useDevice(pid);
  const unpair = useUnpairDevice(pid);
  const [changing, setChanging] = useState(false);
  const notPaired = q.isError && q.error instanceof ApiError && q.error.code === 'no_device';

  const confirmUnpair = () =>
    Alert.alert('Unpair this VOICE?', 'It will stop getting the schedule until it is paired again.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Unpair', style: 'destructive', onPress: () => unpair.mutate() },
    ]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'VOICE' }} />
      {q.isPending ? (
        <CardSkeleton lines={5} />
      ) : notPaired ? (
        <PairForm pid={pid} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <>
          <Card>
            <View style={styles.head}>
              <AppText variant="title" style={styles.flex}>
                {q.data.deviceId}
              </AppText>
              <StatusBadge status={q.data.status} />
            </View>
            <AppText>Last checked in: {ago(q.data.lastSeen)}</AppText>
            <AppText muted>Camera ({q.data.cameraId}): last used {ago(q.data.cameraLastSeen)}</AppText>
            {q.data.status === 'offline' ? (
              <Banner tone="warning" message="Check that VOICE is plugged in and the WiFi is working." />
            ) : null}
          </Card>
          <AppText variant="title">Slots</AppText>
          {q.data.slots.map((s) => (
            <Card key={s.slot}>
              <View style={styles.head}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  Slot {s.slot}: {s.medicineName ?? 'empty'}
                </AppText>
                {s.lidOpen === null ? null : (
                  <AppText variant="bodyStrong">{s.lidOpen ? 'Lid open' : 'Lid closed'}</AppText>
                )}
              </View>
              {s.lastEventAt ? <AppText muted>Lid last moved {ago(s.lastEventAt)}</AppText> : null}
            </Card>
          ))}
          {changing ? (
            <PairForm pid={pid} initial={{ deviceId: q.data.deviceId, cameraId: q.data.cameraId }} />
          ) : (
            <Button title="Change VOICE code" variant="secondary" onPress={() => setChanging(true)} />
          )}
          <Button title="Unpair VOICE" variant="danger" onPress={confirmUnpair} loading={unpair.isPending} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
