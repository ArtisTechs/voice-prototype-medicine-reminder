import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Alert, Share } from 'react-native';

import { useCaregivers, useCreateInvite, useLeavePatient, usePatient } from '../../../../api/hooks';
import { AppText } from '../../../../components/AppText';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { ListItem } from '../../../../components/ListItem';
import { Screen } from '../../../../components/Screen';
import { Banner, CardSkeleton, ErrorState, errorMessage } from '../../../../components/States';
import { fmtLongDate } from '../../../../lib/format';

export default function ShareScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const patient = usePatient(pid);
  const people = useCaregivers(pid);
  const invite = useCreateInvite(pid);
  const leave = useLeavePatient(pid);
  const code = invite.data?.code;
  const onlyOne = (people.data?.length ?? 0) <= 1;

  const confirmLeave = () =>
    Alert.alert(
      onlyOne ? `Delete ${patient.data?.displayName}?` : `Stop following ${patient.data?.displayName}?`,
      onlyOne
        ? 'You are the only caregiver, so their medicines, history and photos will be deleted.'
        : 'The other caregivers keep everything.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: onlyOne ? 'Delete' : 'Leave',
          style: 'destructive',
          onPress: async () => {
            await leave.mutateAsync();
            router.replace('/');
          },
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Share' }} />
      <Card>
        <AppText variant="title">Invite a family member</AppText>
        <AppText>They install this app, tap “Join with a code” and type the code. A code works once, for 7 days.</AppText>
        {invite.isError ? <Banner tone="error" message={errorMessage(invite.error)} /> : null}
        {code ? (
          <>
            <AppText variant="display" accessibilityLabel={`Code: ${code.split('').join(' ')}`} selectable style={{ letterSpacing: 6 }}>
              {code}
            </AppText>
            <AppText muted>Valid until {fmtLongDate(invite.data!.expiresAt)}</AppText>
            <Button
              title="Send the code"
              icon="share-social"
              onPress={() => Share.share({ message: `Join me in VOICE to help look after ${patient.data?.displayName}. Code: ${code}` })}
            />
          </>
        ) : (
          <Button title="Make a code" icon="key" onPress={() => invite.mutate()} loading={invite.isPending} />
        )}
      </Card>

      <AppText variant="title">Caregivers</AppText>
      {people.isPending ? (
        <CardSkeleton />
      ) : people.isError ? (
        <ErrorState error={people.error} onRetry={people.refetch} />
      ) : (
        <Card>
          {people.data.map((c) => (
            <ListItem key={c.id} icon="person-circle" title={c.name} subtitle={c.role === 'owner' ? 'Set up by' : 'Helper'} />
          ))}
        </Card>
      )}
      <Button
        title={onlyOne ? 'Delete this person and their data' : 'Stop following this person'}
        variant="danger"
        onPress={confirmLeave}
        loading={leave.isPending}
      />
    </Screen>
  );
}
