import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useAcceptInvite } from '../../../api/hooks';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { Banner } from '../../../components/States';
import { applyServerErrors, FormTextField } from '../../../features/forms';

const schema = z.object({
  code: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/\s/g, ''))
    .pipe(z.string().length(6, 'The code has 6 letters and numbers.')),
});
type Values = z.input<typeof schema>;

export default function JoinPatient() {
  const accept = useAcceptInvite();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { code: '' } });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const p = await accept.mutateAsync(v.code.trim().toUpperCase());
      router.replace(`/patients/${p.id}`);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { code: 'code' }, { invite_invalid: 'code' }));
    }
  });
  return (
    <Screen>
      <AppText muted>Ask the family member who set up the pillbox to open “Share” and give you the code.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField
        control={control}
        name="code"
        label="Code"
        helper="6 letters and numbers, for example K7PM2Q."
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={8}
        style={{ fontSize: 24, letterSpacing: 4 }}
      />
      <Button title="Join" onPress={() => onSubmit()} loading={accept.isPending} />
    </Screen>
  );
}
