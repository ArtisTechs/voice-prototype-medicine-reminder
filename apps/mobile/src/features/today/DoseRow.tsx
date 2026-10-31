import { StyleSheet, View } from 'react-native';

import type { TodayDose } from '../../api/types';
import { AppText } from '../../components/AppText';
import { IconCircle } from '../../components/Decor';
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

export function partOfDay(hhmm: string): 'Morning' | 'Afternoon' | 'Evening' {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}

const ICON = { upcoming: 'medical', due: 'alarm', taken: 'checkmark', late: 'time', missed: 'close', expired: 'warning' } as const;
const TONE = { upcoming: 'neutral', due: 'due', taken: 'taken', late: 'taken', missed: 'missed', expired: 'expired' } as const;

/** One dose on the timeline: time, medicine, status (icon + word). Urgent states get a coloured edge. */
export function DoseRow({ dose, timeZone }: { dose: TodayDose; timeZone?: string; last?: boolean }) {
  const { colors, status, scheme } = useTheme();
  const urgent = dose.status === 'due' || dose.status === 'missed';
  const label = statusLabel(dose, timeZone);
  return (
    <View
      accessible
      accessibilityLabel={`${fmtClock(dose.time)}. ${dose.medicineName}, ${dose.dose}${dose.slot ? `, slot ${dose.slot}` : ''}. ${label}.`}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: urgent ? status[dose.status].fg : scheme === 'dark' ? colors.border : 'transparent',
          borderWidth: urgent ? 2 : 1,
        },
      ]}
    >
      <IconCircle icon={ICON[dose.status]} tone={TONE[dose.status]} size={48} />
      <View style={styles.body}>
        <AppText variant="bodyStrong" muted>
          {fmtClock(dose.time)}
        </AppText>
        <AppText variant="title">{dose.medicineName}</AppText>
        <AppText muted>
          {dose.dose}
          {dose.slot ? ` · Slot ${dose.slot}` : ''}
          {dose.instructions ? ` · ${dose.instructions}` : ''}
        </AppText>
        <StatusBadge status={dose.status} label={label} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, alignItems: 'flex-start' },
  body: { flex: 1, gap: 4 },
});
