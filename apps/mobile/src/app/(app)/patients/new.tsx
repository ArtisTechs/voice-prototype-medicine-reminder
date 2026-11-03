import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Alert } from 'react-native';
import { z } from 'zod';

import { useCreatePatient, useNearbyDevices, usePairDevice } from '../../../api/hooks';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { Banner, errorMessage } from '../../../components/States';
import { applyServerErrors, FormTextField } from '../../../features/forms';
import { VoicePicker } from '../../../features/patients/VoicePicker';

const schema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name.').max(60, 'Use 60 characters or fewer.'),
  note: z.string().trim().max(200, 'Use 200 characters or fewer.'),
});
type Values = z.infer<typeof schema>;

export default function NewPatient() {
  const create = useCreatePatient();
  const pair = usePairDevice();
  const nearby = useNearbyDevices();
  // undefined = not chosen yet: a new VOICE (or one you already use) is picked for you.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const first = nearby.data?.find((d) => !d.paired || d.mine);
  const voice = picked === undefined ? (first?.deviceId ?? null) : picked;
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', note: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    let id: number;
    try {
      id = (await create.mutateAsync({ displayName: v.displayName.trim(), note: v.note.trim() || undefined })).id;
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { displayName: 'displayName', note: 'note' }));
      return;
    }
    if (voice) {
      try {
        await pair.mutateAsync({ patientId: id, deviceId: voice });
        router.replace(`/patients/${id}`);
        return;
      } catch (e) {
        Alert.alert('Person added, VOICE not connected', errorMessage(e));
      }
    }
    router.replace(`/patients/${id}/device`);
  });
  return (
    <Screen>
      <AppText muted>Only a name is needed. We don't ask for birth dates or ID numbers.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField control={control} name="displayName" label="Name" helper='What you call them, e.g. "Lola Rosa".' />
      <FormTextField control={control} name="note" label="Note (optional)" multiline />
      <AppText variant="title">Which VOICE?</AppText>
      <AppText muted>Several people can share one VOICE. You can change this later.</AppText>
      <VoicePicker devices={nearby.data} selectedId={voice} actionLabel="Use this VOICE" onPick={setPicked} />
      {voice ? <Button title="Choose later" variant="ghost" onPress={() => setPicked(null)} /> : null}
      <Button
        title={voice ? `Add person to ${voice}` : 'Add person'}
        onPress={() => onSubmit()}
        loading={create.isPending || pair.isPending}
      />
    </Screen>
  );
}
