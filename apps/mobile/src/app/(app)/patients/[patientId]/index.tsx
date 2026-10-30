import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useMe, usePatient, useToday } from '../../../../api/hooks';
import { AppText } from '../../../../components/AppText';
import { ProgressBar } from '../../../../components/ProgressBar';
import { Screen } from '../../../../components/Screen';
import { CardSkeleton, EmptyState, ErrorState } from '../../../../components/States';
import { fmtLongDate } from '../../../../lib/format';
import { DoseRow } from '../../../../features/today/DoseRow';
import { useTheme } from '../../../../theme/ThemeProvider';
import { minTouch, radius, spacing } from '../../../../theme/tokens';

const LINKS: { path: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { path: 'medicines', label: 'Medicines', icon: 'medkit' },
  { path: 'history', label: 'History', icon: 'calendar' },
  { path: 'device', label: 'Pillbox', icon: 'hardware-chip' },
  { path: 'scans', label: 'Scans', icon: 'camera' },
  { path: 'share', label: 'Share', icon: 'people' },
];

export default function PatientToday() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const patient = usePatient(pid);
  const today = useToday(pid);
  const tz = useMe().data?.timezone;
  const { colors } = useTheme();
  const s = today.data?.summary;

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
            style={({ pressed }) => [
              styles.tile,
              { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name={l.icon} size={26} color={colors.primary} />
            <AppText variant="bodyStrong">{l.label}</AppText>
          </Pressable>
        ))}
      </View>

      <AppText variant="headline">Today</AppText>
      {today.data ? <AppText muted>{fmtLongDate(today.data.date)}</AppText> : null}
      {today.isPending ? (
        <>
          <CardSkeleton />
          <CardSkeleton />
        </>
      ) : today.isError ? (
        <ErrorState error={today.error} onRetry={today.refetch} />
      ) : today.data.doses.length === 0 ? (
        <EmptyState
          icon="medkit-outline"
          title="No doses today"
          message="Add a medicine with a slot and a dose time so the pillbox can remind them."
          actionLabel="Add a medicine"
          onAction={() => router.push(`/patients/${pid}/medicine/new`)}
        />
      ) : (
        <>
          {s ? <ProgressBar done={s.taken + s.late} total={s.total} label={`${s.taken + s.late} of ${s.total} taken`} /> : null}
          <View>
            {today.data.doses.map((d, i) => (
              <DoseRow key={d.scheduleId} dose={d} timeZone={tz} last={i === today.data.doses.length - 1} />
            ))}
          </View>
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
    minHeight: minTouch + 32,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
});
