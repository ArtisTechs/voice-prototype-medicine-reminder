import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useMedicines } from '../../../../api/hooks';
import type { Medicine } from '../../../../api/types';
import { AppText } from '../../../../components/AppText';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { Screen } from '../../../../components/Screen';
import { CardSkeleton, EmptyState, ErrorState } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { fmtClock, fmtLongDate } from '../../../../lib/format';
import { spacing } from '../../../../theme/tokens';

function MedicineCard({ pid, m }: { pid: number; m: Medicine }) {
  const times = m.schedules.filter((s) => s.active).map((s) => fmtClock(s.time));
  return (
    <Card onPress={() => router.push(`/patients/${pid}/medicine/${m.id}`)} accessibilityLabel={`${m.label}. Open to edit.`}>
      <View style={styles.head}>
        <AppText variant="title" style={styles.flex}>
          {m.label}
        </AppText>
        <AppText variant="bodyStrong">{m.slot ? `Slot ${m.slot}` : 'No slot'}</AppText>
      </View>
      <AppText muted>{times.length ? times.join(' · ') : 'No dose times yet'}</AppText>
      <AppText>
        {m.qty} left{m.daysLeft !== null ? ` · about ${Math.floor(m.daysLeft)} days` : ''}
      </AppText>
      {m.expiryDate ? <AppText muted>Expires {fmtLongDate(m.expiryDate)}</AppText> : null}
      <View style={styles.badges}>
        {m.expired ? <StatusBadge status="expired" /> : null}
        {m.lowStock ? <StatusBadge status="lowStock" /> : null}
      </View>
    </Card>
  );
}

export default function Medicines() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const q = useMedicines(pid);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'Medicines' }} />
      <Button title="Add a medicine" icon="add" onPress={() => router.push(`/patients/${pid}/medicine/new`)} />
      {q.isPending ? (
        <>
          <CardSkeleton />
          <CardSkeleton />
        </>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : q.data.length === 0 ? (
        <EmptyState icon="medkit-outline" title="No medicines yet" message="Add the first one. It takes about a minute." />
      ) : (
        q.data.map((m) => <MedicineCard key={m.id} pid={pid} m={m} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  badges: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
});
