import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useDashboard } from '../../../api/hooks';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { Screen } from '../../../components/Screen';
import { Banner, CardSkeleton, EmptyState, ErrorState, errorMessage } from '../../../components/States';
import { PatientCardView } from '../../../features/dashboard/PatientCardView';
import { PushPrompt } from '../../../notifications/PushPrompt';
import { useRealtime } from '../../../realtime/RealtimeProvider';
import { spacing } from '../../../theme/tokens';

export default function Dashboard() {
  const q = useDashboard();
  const { connected } = useRealtime();
  const patients = q.data?.patients ?? [];

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isError && q.data ? <Banner tone="error" message={errorMessage(q.error)} /> : null}
      {!connected && q.data ? <Banner tone="info" message="Live updates paused. Pull down to refresh." /> : null}
      {q.isPending ? (
        <>
          <CardSkeleton lines={4} />
          <CardSkeleton lines={4} />
        </>
      ) : q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : patients.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No one added yet"
          message="Add the person whose medicines you look after, or join a family member with their code."
          actionLabel="Add a person"
          onAction={() => router.push('/patients/new')}
        />
      ) : (
        <>
          <AppText variant="headline">Today</AppText>
          {patients.map((card) => (
            <PatientCardView key={card.id} card={card} />
          ))}
        </>
      )}
      {q.data ? <PushPrompt /> : null}
      <View style={styles.actions}>
        {patients.length > 0 ? (
          <Button title="Add a person" variant="secondary" icon="person-add" onPress={() => router.push('/patients/new')} />
        ) : null}
        <Button title="Join with a code" variant="secondary" icon="key" onPress={() => router.push('/patients/join')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ actions: { gap: spacing.sm, marginTop: spacing.md } });
