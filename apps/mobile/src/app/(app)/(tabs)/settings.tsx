import { useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { api } from '../../../api/client';
import { useMe, useUpdateMe } from '../../../api/hooks';
import type { NotifyPrefs } from '../../../api/types';
import { useAuth } from '../../../auth/AuthProvider';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ChoiceGroup, TextField } from '../../../components/Fields';
import { Screen } from '../../../components/Screen';
import { Banner, CardSkeleton, ErrorState, errorMessage } from '../../../components/States';
import { SwitchRow } from '../../../components/SwitchRow';
import { forgetPushToken, storedPushToken } from '../../../notifications/push';
import { PushPrompt } from '../../../notifications/PushPrompt';
import { useTheme, type ThemePref } from '../../../theme/ThemeProvider';
import { spacing } from '../../../theme/tokens';

const PREFS: { key: keyof NotifyPrefs; label: string; description: string }[] = [
  { key: 'missed', label: 'Missed doses', description: 'When a dose is not taken within 30 minutes.' },
  { key: 'taken', label: 'Doses taken', description: 'Every time a dose is taken. Off by default.' },
  { key: 'lowStock', label: 'Running low', description: 'When it is time to refill.' },
  { key: 'expiry', label: 'Expiry dates', description: '30 days, 7 days and on the day a medicine expires.' },
  { key: 'expiredDose', label: 'Expired medicine due', description: 'When a dose is due but the medicine has expired.' },
  { key: 'offline', label: 'VOICE offline', description: 'When VOICE has not checked in for 10 minutes.' },
  { key: 'scanUnknown', label: 'Unknown scans', description: 'When the VOICE camera does not recognise a box.' },
  { key: 'hideMedicineNames', label: 'Hide medicine names', description: 'Lock-screen alerts say “a medicine” instead.' },
];

const ZONES = [
  { value: 'Asia/Manila', label: 'Philippines' },
  { value: 'Asia/Singapore', label: 'Singapore' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Europe/London', label: 'London' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
];

export default function Settings() {
  const me = useMe();
  const update = useUpdateMe();
  const { signOut, forget } = useAuth();
  const { pref, setPref } = useTheme();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (me.data) setName(me.data.name);
  }, [me.data]);

  const save = async (body: Parameters<typeof update.mutateAsync>[0]) => {
    setError(null);
    try {
      await update.mutateAsync(body);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const doSignOut = async () => {
    const pushToken = await storedPushToken();
    await forgetPushToken();
    await signOut({ pushToken });
  };

  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'Your account and alerts are deleted. People only you look after are deleted too, with their medicines, history and photos. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await api('/api/v1/me', { method: 'DELETE' });
              await forgetPushToken();
              await forget();
            } catch (e) {
              setError(errorMessage(e));
              setDeleting(false);
            }
          },
        },
      ],
    );

  if (me.isPending) return <Screen><CardSkeleton lines={6} /></Screen>;
  if (me.isError) return <Screen><ErrorState error={me.error} onRetry={me.refetch} /></Screen>;
  const prefs = me.data.notifyPrefs;

  return (
    <Screen>
      {error ? <Banner tone="error" message={error} /> : null}
      <Card>
        <AppText variant="title">Profile</AppText>
        <AppText muted>{me.data.email}</AppText>
        <TextField label="Your name" value={name} onChangeText={setName} maxLength={80} />
        <Button
          title="Save name"
          variant="secondary"
          disabled={!name.trim() || name.trim() === me.data.name}
          onPress={() => save({ name: name.trim() })}
        />
      </Card>

      <PushPrompt />

      <Card>
        <AppText variant="title">Notifications</AppText>
        {PREFS.map((p) => (
          <SwitchRow
            key={p.key}
            label={p.label}
            description={p.description}
            value={prefs[p.key]}
            onChange={(v) => save({ notifyPrefs: { ...prefs, [p.key]: v } })}
          />
        ))}
      </Card>

      <Card>
        <ChoiceGroup<string>
          label="Time zone"
          helper="Times in the app are shown in this zone. VOICE always uses Philippine time."
          value={me.data.timezone}
          onChange={(tz) => save({ timezone: tz })}
          choices={ZONES.some((z) => z.value === me.data.timezone) ? ZONES : [...ZONES, { value: me.data.timezone, label: me.data.timezone }]}
        />
        <ChoiceGroup<ThemePref>
          label="Appearance"
          value={pref}
          onChange={setPref}
          choices={[
            { value: 'system', label: 'Same as phone' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </Card>

      <Card>
        <AppText variant="title">Privacy</AppText>
        <AppText>
          We keep only what is needed: a name for each person, their medicines and dose history. VOICE camera photos are deleted
          after 30 days.
        </AppText>
      </Card>

      <Button title="Sign out" variant="secondary" icon="log-out" onPress={doSignOut} />
      <Button title="Delete my account and data" variant="danger" icon="trash" onPress={confirmDelete} loading={deleting} style={styles.last} />
    </Screen>
  );
}

const styles = StyleSheet.create({ last: { marginTop: spacing.md } });
