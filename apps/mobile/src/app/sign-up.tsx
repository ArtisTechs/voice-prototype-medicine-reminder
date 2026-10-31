import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '../auth/AuthProvider';
import { AppText } from '../components/AppText';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { Banner } from '../components/States';
import { signUpSchema, type SignUpValues } from '../features/auth/schema';
import { applyServerErrors, FormTextField } from '../features/forms';

export default function SignUp() {
  const { signUp } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '', confirm: '' },
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await signUp(v.name.trim(), v.email.trim(), v.password);
    } catch (e) {
      setFormError(
        applyServerErrors(e, setError, { name: 'name', email: 'email', password: 'password' }, { email_taken: 'email' }),
      );
    }
  });

  return (
    <Screen>
      <Brand tagline="Set up once. Know every dose was taken." />
      <AppText variant="headline">Create your account</AppText>
      <AppText muted>You can look after one or more people, and share them with other family members.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField control={control} name="name" label="Your name" autoComplete="name" textContentType="name" />
      <FormTextField
        control={control}
        name="email"
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
      />
      <FormTextField
        control={control}
        name="password"
        label="Password"
        helper="At least 8 characters."
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormTextField control={control} name="confirm" label="Type the password again" secureTextEntry />
      <Button title="Create account" onPress={() => onSubmit()} loading={formState.isSubmitting} />
    </Screen>
  );
}
