import { zodResolver } from '@hookform/resolvers/zod';
import { Link } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { useAuth } from '../auth/AuthProvider';
import { AppText } from '../components/AppText';
import { Brand } from '../components/Brand';
import { Button } from '../components/Button';
import { Screen } from '../components/Screen';
import { Banner } from '../components/States';
import { signInSchema, type SignInValues } from '../features/auth/schema';
import { applyServerErrors, FormTextField } from '../features/forms';

export default function SignIn() {
  const { signIn } = useAuth();
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, formState } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onBlur',
  });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await signIn(v.email.trim(), v.password);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, { email: 'email', password: 'password' }));
    }
  });

  return (
    <Screen edges={['top', 'left', 'right']}>
      <Brand tagline="Medicine reminders your family can see." />
      <AppText variant="headline">Welcome back</AppText>
      <AppText muted>Sign in to see how your family member is doing with their medicines.</AppText>
      {formError ? <Banner tone="error" message={formError} /> : null}
      <FormTextField
        control={control}
        name="email"
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
      />
      <FormTextField
        control={control}
        name="password"
        label="Password"
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => onSubmit()}
      />
      <Button title="Sign in" onPress={() => onSubmit()} loading={formState.isSubmitting} />
      <Link href="/sign-up" asChild>
        <Button title="Create an account" variant="secondary" />
      </Link>
    </Screen>
  );
}
