import { router, Stack, useLocalSearchParams } from 'expo-router';

import { useMedicines, useSaveMedicine } from '../../../../../api/hooks';
import { AppText } from '../../../../../components/AppText';
import { Screen } from '../../../../../components/Screen';
import { CardSkeleton, ErrorState } from '../../../../../components/States';
import { MedicineForm } from '../../../../../features/medicines/MedicineForm';
import { toInput } from '../../../../../features/medicines/schema';

export default function NewMedicine() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const meds = useMedicines(pid);
  const save = useSaveMedicine(pid);
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Add a medicine' }} />
      <AppText muted>After saving you can add dose times and photos of the box.</AppText>
      {meds.isPending ? (
        <CardSkeleton lines={6} />
      ) : meds.isError ? (
        <ErrorState error={meds.error} onRetry={meds.refetch} />
      ) : (
        <MedicineForm
          others={meds.data}
          submitLabel="Save medicine"
          onSubmit={async (v) => {
            const m = await save.mutateAsync(toInput(v));
            router.replace(`/patients/${pid}/medicine/${m.id}`);
          }}
        />
      )}
    </Screen>
  );
}
