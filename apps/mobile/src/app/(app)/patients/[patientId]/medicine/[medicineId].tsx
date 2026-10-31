import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { useDeleteMedicine, useMedicine, useMedicines, useSaveMedicine } from '../../../../../api/hooks';
import { Button } from '../../../../../components/Button';
import { Screen } from '../../../../../components/Screen';
import { Banner, CardSkeleton, ErrorState } from '../../../../../components/States';
import { StatusBadge } from '../../../../../components/StatusBadge';
import { MedicineForm } from '../../../../../features/medicines/MedicineForm';
import { PhotoSection } from '../../../../../features/medicines/PhotoSection';
import { ScheduleSection } from '../../../../../features/medicines/ScheduleSection';
import { toInput } from '../../../../../features/medicines/schema';

export default function EditMedicine() {
  const { patientId, medicineId } = useLocalSearchParams<{ patientId: string; medicineId: string }>();
  const pid = Number(patientId);
  const mid = Number(medicineId);
  const med = useMedicine(pid, mid);
  const meds = useMedicines(pid);
  const save = useSaveMedicine(pid, mid);
  const del = useDeleteMedicine(pid);
  const [saved, setSaved] = useState(false);

  const confirmDelete = () =>
    Alert.alert(`Delete ${med.data?.label}?`, 'It leaves the VOICE schedule. Past history is kept.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await del.mutateAsync(mid);
          router.back();
        },
      },
    ]);

  return (
    <Screen refreshing={med.isRefetching} onRefresh={med.refetch}>
      <Stack.Screen options={{ title: med.data?.label ?? 'Medicine' }} />
      {med.isPending || meds.isPending ? (
        <CardSkeleton lines={6} />
      ) : med.isError ? (
        <ErrorState error={med.error} onRetry={med.refetch} />
      ) : (
        <>
          {med.data.expired ? <StatusBadge status="expired" label="Expired: replace this box" /> : null}
          {med.data.lowStock ? <StatusBadge status="lowStock" label={`Running low: ${med.data.qty} left`} /> : null}
          <ScheduleSection pid={pid} medicine={med.data} />
          <PhotoSection pid={pid} mid={mid} />
          {saved ? <Banner tone="info" message="Saved." /> : null}
          <MedicineForm
            key={med.data.id}
            medicine={med.data}
            others={meds.data ?? []}
            submitLabel="Save changes"
            onSubmit={async (v) => {
              setSaved(false);
              await save.mutateAsync(toInput(v));
              setSaved(true);
            }}
          />
          <Button title="Delete medicine" variant="danger" icon="trash" onPress={confirmDelete} loading={del.isPending} />
        </>
      )}
    </Screen>
  );
}
