import { StyleSheet, View } from 'react-native';

import type { TodayDose } from '../../api/types';
import { AppText } from '../../components/AppText';
import { StatusBadge } from '../../components/StatusBadge';
import { fmtClock, fmtTimeOfDate } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

export function statusLabel(d: TodayDose, timeZone?: string): string {
  switch (d.status) {
    case 'taken':
      return d.takenAt ? `Taken ${fmtTimeOfDate(d.takenAt, timeZone)}` : 'Taken';
    case 'late':
      return `Taken late${d.delayMinutes ? ` (${d.delayMinutes} min)` : ''}`;
    case 'due':
      return 'Due now';
    case 'missed':
      return 'Missed';
    case 'expired':
      return 'Expired medicine';
    default:
      return 'Upcoming';
  }
}

/** One dose on the timeline: time rail, medicine, status (icon + word). */
export function DoseRow({ dose, timeZone, last }: { dose: TodayDose; timeZone?: string; last?: boolean }) {
  const { colors, status } = useTheme();
  const tone = status[dose.status];
  const label = statusLabel(dose, timeZone);
  return (
    <View
      accessible
      accessibilityLabel={`${fmtClock(dose.time)}. ${dose.medicineName}, ${dose.dose}${dose.slot ? `, slot ${dose.slot}` : ''}. ${label}.`}
      style={styles.row}
    >
      <View style={styles.rail}>
        <AppText variant="bodyStrong">{fmtClock(dose.time)}</AppText>
        <View style={[styles.dot, { backgroundColor: tone.fg }]} />
        {!last ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
      </View>
      <View style={[styles.card, { borderColor: dose.status === 'due' || dose.status === 'missed' ? tone.fg : colors.border, backgroundColor: colors.surface }]}>
        <AppText variant="title">{dose.medicineName}</AppText>
        <AppText muted>
          {dose.dose}
          {dose.slot ? ` · Slot ${dose.slot}` : ''}
        </AppText>
        {dose.instructions ? <AppText>{dose.instructions}</AppText> : null}
        <StatusBadge status={dose.status} label={label} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 84, alignItems: 'center', gap: spacing.xs },
  dot: { width: 14, height: 14, borderRadius: 7 },
  line: { width: 2, flex: 1, minHeight: 24 },
  card: { flex: 1, borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.md },
});
