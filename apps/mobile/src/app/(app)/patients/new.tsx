import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useCreatePatient } from '../../../api/hooks';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { Banner } from '../../../components/States';
import { applyServerErrors, FormTextField } from '../../../features/forms';

const schema = z.object({
  displayName: z.string().trim().min(1, 'Enter a name.').max(60, 'Use 60 characters or fewer.'),
  note: z.string().trim().max(200, 'Use 200 characters or fewer.'),
});
type Values = z.infer<typeof schema>;

export default function NewPatient() {
  const create = useCreatePatient();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: '', note: '' },
  });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const p = await create.mutateAsync({ displayName: v.displayName.trim(), note: v.note.trim() || undefined });
      router.replace(`/patients/${p.id}/device`);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { displayName: 'displayName', note: 'note' }));
    }
  });
  return (
    <Screen>
      <AppText muted>Only a name is needed. We don't ask for birth dates or ID numbers.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField control={control} name="displayName" label="Name" helper='What you call them, e.g. "Lola Rosa".' />
      <FormTextField control={control} name="note" label="Note (optional)" multiline />
      <Button title="Add person" onPress={() => onSubmit()} loading={create.isPending} />
    </Screen>
  );
}
