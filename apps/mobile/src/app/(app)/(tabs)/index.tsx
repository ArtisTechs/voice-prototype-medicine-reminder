import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useDashboard, useMe } from '../../../api/hooks';
import { AppText } from '../../../components/AppText';
import { Card } from '../../../components/Card';
import { IconCircle } from '../../../components/Decor';
import { Screen } from '../../../components/Screen';
import { Banner, CardSkeleton, EmptyState, ErrorState, errorMessage } from '../../../components/States';
import { PatientCardView } from '../../../features/dashboard/PatientCardView';
import { PushPrompt } from '../../../notifications/PushPrompt';
import { useRealtime } from '../../../realtime/RealtimeProvider';
import { useTheme } from '../../../theme/ThemeProvider';
import { minTouch, radius, spacing } from '../../../theme/tokens';

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function QuickAction({ icon, label, onPress }: { icon: 'person-add' | 'key'; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <IconCircle icon={icon} tone="primary" size={40} />
      <AppText variant="bodyStrong" style={styles.flex}>
        {label}
      </AppText>
    </Pressable>
  );
}

export default function Dashboard() {
  const q = useDashboard();
  const me = useMe();
  const { connected } = useRealtime();
  const patients = q.data?.patients ?? [];
  const firstName = me.data?.name.split(' ')[0];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch} edges={['top', 'left', 'right']}>
      <View style={styles.hello}>
        <AppText muted>{today}</AppText>
        <AppText variant="headline">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </AppText>
      </View>
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
        <Card>
          <EmptyState
            icon="people-outline"
            title="No one added yet"
            message="Add the person whose medicines you look after, or join a family member with their code."
            actionLabel="Add a person"
            onAction={() => router.push('/patients/new')}
          />
        </Card>
      ) : (
        patients.map((card) => <PatientCardView key={card.id} card={card} />)
      )}

      {q.data ? <PushPrompt /> : null}

      <AppText variant="title" style={styles.sectionTitle}>
        More
      </AppText>
      <View style={styles.actions}>
        <QuickAction icon="person-add" label="Add a person" onPress={() => router.push('/patients/new')} />
        <QuickAction icon="key" label="Join with a code" onPress={() => router.push('/patients/join')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: { gap: 2, marginBottom: spacing.xs },
  sectionTitle: { marginTop: spacing.sm },
  actions: { gap: spacing.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: minTouch + 16,
    borderRadius: radius.lg,
  },
  flex: { flex: 1 },
});
