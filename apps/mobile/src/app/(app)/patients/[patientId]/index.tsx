import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useMe, usePatient, useToday } from '../../../../api/hooks';
import type { TodayDose } from '../../../../api/types';
import { AppText } from '../../../../components/AppText';
import { Card } from '../../../../components/Card';
import { IconCircle, SectionHeader } from '../../../../components/Decor';
import { ProgressBar } from '../../../../components/ProgressBar';
import { Screen } from '../../../../components/Screen';
import { CardSkeleton, EmptyState, ErrorState } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { DoseRow, partOfDay, statusLabel } from '../../../../features/today/DoseRow';
import { fmtClock, fmtLongDate } from '../../../../lib/format';
import { useTheme } from '../../../../theme/ThemeProvider';
import { minTouch, radius, spacing } from '../../../../theme/tokens';

const LINKS: { path: string; label: string; icon: keyof typeof Ionicons.glyphMap; tone: 'primary' | 'accent' | 'due' | 'expired' | 'lowStock' }[] = [
  { path: 'medicines', label: 'Medicines', icon: 'medkit', tone: 'primary' },
  { path: 'history', label: 'History', icon: 'bar-chart', tone: 'accent' },
  { path: 'device', label: 'VOICE', icon: 'hardware-chip', tone: 'lowStock' },
  { path: 'scans', label: 'Scans', icon: 'camera', tone: 'expired' },
  { path: 'share', label: 'Family', icon: 'people', tone: 'due' },
];

function NextUp({ dose, timeZone }: { dose: TodayDose; timeZone?: string }) {
  const { colors } = useTheme();
  return (
    <Card tone="tinted" accessibilityLabel={`Next up at ${fmtClock(dose.time)}: ${dose.medicineName}.`}>
      <AppText variant="caption" color={colors.primary}>
        {dose.status === 'due' ? 'DUE NOW' : 'NEXT UP'}
      </AppText>
      <AppText variant="display">{fmtClock(dose.time)}</AppText>
      <AppText variant="title">{dose.medicineName}</AppText>
      <AppText>
        {dose.dose}
        {dose.slot ? ` from slot ${dose.slot}` : ''}
        {dose.instructions ? ` · ${dose.instructions}` : ''}
      </AppText>
      <StatusBadge status={dose.status} label={statusLabel(dose, timeZone)} />
    </Card>
  );
}

export default function PatientToday() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const patient = usePatient(pid);
  const today = useToday(pid);
  const tz = useMe().data?.timezone;
  const { colors } = useTheme();
  const s = today.data?.summary;
  const doses = today.data?.doses ?? [];
  const next = doses.find((d) => d.status === 'due') ?? doses.find((d) => d.status === 'upcoming');
  const groups = (['Morning', 'Afternoon', 'Evening'] as const)
    .map((name) => ({ name, items: doses.filter((d) => partOfDay(d.time) === name) }))
    .filter((g) => g.items.length > 0);

  return (
    <Screen refreshing={today.isRefetching} onRefresh={today.refetch}>
      <Stack.Screen options={{ title: patient.data?.displayName ?? 'Today' }} />

      <View style={styles.grid}>
        {LINKS.map((l) => (
          <Pressable
            key={l.path}
            accessibilityRole="button"
            accessibilityLabel={l.label}
            onPress={() => router.push(`/patients/${pid}/${l.path}` as Href)}
            style={({ pressed }) => [styles.tile, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
          >
            <IconCircle icon={l.icon} tone={l.tone} size={44} />
            <AppText variant="bodyStrong">{l.label}</AppText>
          </Pressable>
        ))}
      </View>

      {today.isPending ? (
        <>
          <CardSkeleton lines={4} />
          <CardSkeleton />
        </>
      ) : today.isError ? (
        <ErrorState error={today.error} onRetry={today.refetch} />
      ) : doses.length === 0 ? (
        <Card>
          <EmptyState
            icon="medkit-outline"
            title="No doses today"
            message="Add a medicine with a slot and a dose time so VOICE can remind them."
            actionLabel="Add a medicine"
            onAction={() => router.push(`/patients/${pid}/medicine/new`)}
          />
        </Card>
      ) : (
        <>
          {next ? <NextUp dose={next} timeZone={tz} /> : null}
          {s ? (
            <Card>
              <View style={styles.summaryRow}>
                <AppText variant="title" style={styles.flex}>
                  Today
                </AppText>
                <AppText muted>{fmtLongDate(today.data.date)}</AppText>
              </View>
              <ProgressBar done={s.taken + s.late} total={s.total} label={`${s.taken + s.late} of ${s.total} taken`} />
            </Card>
          ) : null}
          {groups.map((g) => (
            <View key={g.name} style={styles.group}>
              <SectionHeader title={g.name} />
              {g.items.map((d) => (
                <DoseRow key={d.scheduleId} dose={d} timeZone={tz} />
              ))}
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: minTouch + 40,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  group: { gap: spacing.sm },
});
