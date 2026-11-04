import { zodResolver } from '@hookform/resolvers/zod';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { useDevice, useNearbyDevices, usePairDevice, useUnpairDevice } from '../../../../api/hooks';
import { AppText } from '../../../../components/AppText';
import { useDialog } from '../../../../components/Dialog';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { Banner, CardSkeleton, ErrorState, errorMessage } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { applyServerErrors, FormTextField } from '../../../../features/forms';
import { VoicePicker } from '../../../../features/patients/VoicePicker';
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

function PairForm({ pid, initial, onDone }: { pid: number; initial?: Values; onDone?: () => void }) {
  const pair = usePairDevice(pid);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: initial ?? { deviceId: '', cameraId: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await pair.mutateAsync({ deviceId: v.deviceId.trim(), cameraId: v.cameraId.trim() || null });
      onDone?.();
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { deviceId: 'deviceId', cameraId: 'cameraId' }, { device_taken: 'deviceId' }));
    }
  });
  return (
    <Card>
      <AppText variant="title">Type the VOICE code</AppText>
      <AppText>The demo VOICE uses “pillbox”.</AppText>
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
      <Button title="Connect VOICE" icon="link" onPress={() => onSubmit()} loading={pair.isPending} />
    </Card>
  );
}

/** Found VOICEs to tap, with typing the code as the fallback. */
function Connect({ pid, currentId, onDone }: { pid: number; currentId?: string; onDone?: () => void }) {
  const nearby = useNearbyDevices();
  const pair = usePairDevice(pid);
  const [typing, setTyping] = useState(false);
  const connect = (deviceId: string) => pair.mutate({ deviceId }, { onSuccess: onDone });
  return (
    <>
      <AppText variant="title">{currentId ? 'Move to another VOICE' : 'Connect VOICE'}</AppText>
      <AppText muted>One VOICE can remind several people. Each person needs their own slots.</AppText>
      {pair.isError ? <Banner tone="error" message={errorMessage(pair.error)} /> : null}
      <VoicePicker
        devices={nearby.data}
        currentId={currentId}
        pendingId={pair.isPending ? pair.variables?.deviceId : null}
        actionLabel="Connect"
        onPick={connect}
      />
      {typing ? (
        <PairForm pid={pid} onDone={onDone} />
      ) : (
        <Button title="Type the code instead" variant="ghost" icon="keypad" onPress={() => setTyping(true)} />
      )}
    </>
  );
}

export default function DeviceScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const q = useDevice(pid);
  const unpair = useUnpairDevice(pid);
  const dialog = useDialog();
  const [changing, setChanging] = useState(false);
  const notPaired = q.isError && q.error instanceof ApiError && q.error.code === 'no_device';
  const others = q.data ? q.data.people.filter((p) => !p.current) : [];

  const confirmUnpair = () =>
    dialog.confirm({
      title: 'Remove from this VOICE?',
      message: others.length
        ? 'This person stops getting reminders. The others on this VOICE keep theirs.'
        : 'It will stop getting the schedule until it is connected again.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: 'unlink',
      onConfirm: () => unpair.mutateAsync(),
    });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'VOICE' }} />
      {q.isPending ? (
        <CardSkeleton lines={5} />
      ) : notPaired ? (
        <Connect pid={pid} />
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
          {others.length ? (
            <Card>
              <AppText variant="title">People on this VOICE</AppText>
              {q.data.people.map((p, i) => (
                <AppText key={p.patientId ?? `other-${i}`} variant={p.current ? 'bodyStrong' : 'body'}>
                  {p.name}
                  {p.current ? ' (this person)' : ''}
                </AppText>
              ))}
              <AppText muted>On VOICE, each medicine starts with the person's first name.</AppText>
            </Card>
          ) : null}
          <AppText variant="title">Slots</AppText>
          {q.data.slots.map((s) => (
            <Card key={s.slot}>
              <View style={styles.head}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  Slot {s.slot}: {s.medicineName ?? (s.personName ? 'in use' : 'empty')}
                </AppText>
                {s.lidOpen === null ? null : (
                  <AppText variant="bodyStrong">{s.lidOpen ? 'Lid open' : 'Lid closed'}</AppText>
                )}
              </View>
              {s.personName ? <AppText muted>For {s.personName}</AppText> : null}
              {s.lastEventAt ? <AppText muted>Lid last moved {ago(s.lastEventAt)}</AppText> : null}
            </Card>
          ))}
          {changing ? (
            <Connect pid={pid} currentId={q.data.deviceId} onDone={() => setChanging(false)} />
          ) : (
            <Button title="Move to another VOICE" variant="secondary" icon="swap-horizontal" onPress={() => setChanging(true)} />
          )}
          <Button title="Remove from this VOICE" variant="danger" onPress={confirmUnpair} loading={unpair.isPending} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
});
