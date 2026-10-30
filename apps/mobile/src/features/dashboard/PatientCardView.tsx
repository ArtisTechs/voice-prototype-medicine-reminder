import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { PatientCard } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { ago, fmtClock, plural } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { spacing } from '../../theme/tokens';

export function PatientCardView({ card }: { card: PatientCard }) {
  const { colors } = useTheme();
  const t = card.today;
  const done = t.taken + t.late;
  const summary = `${card.displayName}. ${done} of ${t.total} doses taken today.`;
  return (
    <Card onPress={() => router.push(`/patients/${card.id}`)} accessibilityLabel={`${summary} Open today's doses.`}>
      <View style={styles.header}>
        <AppText variant="title" style={styles.flex}>
          {card.displayName}
        </AppText>
        {card.device ? (
          <StatusBadge status={card.device.status} label={card.device.status === 'online' ? 'Pillbox online' : 'Pillbox offline'} />
        ) : (
          <StatusBadge status="offline" label="No pillbox" />
        )}
      </View>
      {card.device?.status === 'offline' && card.device.lastSeen ? (
        <AppText muted>Last seen {ago(card.device.lastSeen)}</AppText>
      ) : null}

      {t.total > 0 ? (
        <ProgressBar done={done} total={t.total} label={`${done} of ${t.total} taken today`} />
      ) : (
        <AppText muted>No doses scheduled today.</AppText>
      )}

      <View style={styles.badges}>
        {t.missed > 0 ? <StatusBadge status="missed" label={`${plural(t.missed, 'missed dose')}`} /> : null}
        {t.due > 0 ? <StatusBadge status="due" label={`${t.due} due now`} /> : null}
        {t.expired > 0 ? <StatusBadge status="expired" label={`${t.expired} expired`} /> : null}
      </View>

      {card.nextDose ? (
        <Row icon="alarm-outline">
          Next: {fmtClock(card.nextDose.time)} · {card.nextDose.medicineName}
          {card.nextDose.slot ? ` (slot ${card.nextDose.slot})` : ''}
        </Row>
      ) : null}
      {card.unreadAlerts > 0 ? <Row icon="notifications-outline">{plural(card.unreadAlerts, 'new alert')}</Row> : null}
      {card.lowStock.map((m) => (
        <View key={`low-${m.id}`} style={styles.line}>
          <StatusBadge status="lowStock" />
          <AppText style={styles.flex}>
            {m.name}: {m.qty} left
          </AppText>
        </View>
      ))}
      {card.expiringSoon.map((m) => (
        <View key={`exp-${m.id}`} style={styles.line}>
          <StatusBadge status="expired" label={(m.daysToExpiry ?? 0) < 0 ? 'Expired' : 'Expiring'} />
          <AppText style={styles.flex}>
            {m.name}
            {(m.daysToExpiry ?? 0) < 0 ? '' : ` in ${plural(m.daysToExpiry ?? 0, 'day')}`}
          </AppText>
        </View>
      ))}
      <View style={styles.open}>
        <AppText variant="bodyStrong" color={colors.primary}>
          Open today
        </AppText>
        <Ionicons name="chevron-forward" size={20} color={colors.primary} />
      </View>
    </Card>
  );
}

function Row({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <AppText style={styles.flex}>{children}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  open: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
});
