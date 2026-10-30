import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useHistory } from '../../../../api/hooks';
import type { Totals } from '../../../../api/types';
import { AppText } from '../../../../components/AppText';
import { Card } from '../../../../components/Card';
import { ChoiceGroup, DateField } from '../../../../components/Fields';
import { Screen } from '../../../../components/Screen';
import { CardSkeleton, EmptyState, ErrorState } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { addDays, fmtClock, fmtDate, isoDay } from '../../../../lib/format';
import { spacing } from '../../../../theme/tokens';

type Range = '7' | '30' | 'custom';

const pct = (t: Totals) => (t.adherence === null ? '–' : `${Math.round(t.adherence)}%`);

function TotalsLine({ t }: { t: Totals }) {
  return (
    <View style={styles.badges}>
      <StatusBadge status="taken" label={`${t.taken} on time`} />
      {t.late ? <StatusBadge status="late" label={`${t.late} late`} /> : null}
      {t.missed ? <StatusBadge status="missed" label={`${t.missed} missed`} /> : null}
      {t.expired ? <StatusBadge status="expired" label={`${t.expired} expired`} /> : null}
    </View>
  );
}

export default function HistoryScreen() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const [range, setRange] = useState<Range>('7');
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(isoDay(addDays(today, -6)));
  const [to, setTo] = useState(isoDay(today));
  const span =
    range === 'custom' ? { from, to } : { from: isoDay(addDays(today, range === '7' ? -6 : -29)), to: isoDay(today) };
  const q = useHistory(pid, span.from, span.to);
  const hasData = q.data && q.data.records.length > 0;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      <Stack.Screen options={{ title: 'History' }} />
      <ChoiceGroup<Range>
        label="Show"
        value={range}
        onChange={setRange}
        choices={[
          { value: '7', label: 'Last 7 days' },
          { value: '30', label: 'Last 30 days' },
          { value: 'custom', label: 'Choose dates' },
        ]}
      />
      {range === 'custom' ? (
        <>
          <DateField label="From" value={from} onChange={(v) => v && setFrom(v)} />
          <DateField label="To" value={to} onChange={(v) => v && setTo(v)} />
        </>
      ) : null}

      {q.isPending ? (
        <>
          <CardSkeleton />
          <CardSkeleton lines={5} />
        </>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : !hasData ? (
        <EmptyState icon="calendar-outline" title="Nothing recorded yet" message="Doses show up here once the pillbox reports them." />
      ) : (
        <>
          <Card>
            <AppText variant="title">Taken as planned</AppText>
            <AppText variant="display" accessibilityLabel={`Adherence ${pct(q.data.overall)}`}>
              {pct(q.data.overall)}
            </AppText>
            <TotalsLine t={q.data.overall} />
          </Card>

          <AppText variant="title">By medicine</AppText>
          {q.data.medicines.map((m) => (
            <Card key={m.medicineId}>
              <View style={styles.head}>
                <AppText variant="bodyStrong" style={styles.flex}>
                  {m.medicineName}
                </AppText>
                <AppText variant="bodyStrong">{pct(m)}</AppText>
              </View>
              <TotalsLine t={m} />
            </Card>
          ))}

          <AppText variant="title">By day</AppText>
          {[...q.data.days].reverse().map((d) => {
            const recs = q.data.records.filter((r) => r.date === d.date);
            if (recs.length === 0) return null;
            return (
              <Card key={d.date}>
                <View style={styles.head}>
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {fmtDate(d.date)}
                  </AppText>
                  <AppText variant="bodyStrong">{pct(d)}</AppText>
                </View>
                {recs.map((r, i) => (
                  <View key={i} style={styles.rec}>
                    <AppText style={styles.time}>{fmtClock(r.time)}</AppText>
                    <AppText style={styles.flex}>{r.medicineName}</AppText>
                    <StatusBadge status={r.status} label={r.status === 'late' && r.delayMinutes ? `Late ${r.delayMinutes} min` : undefined} />
                  </View>
                ))}
              </Card>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', paddingVertical: 4 },
  time: { minWidth: 84 },
});
