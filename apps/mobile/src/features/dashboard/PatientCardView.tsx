import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { PatientCard } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { Avatar, IconCircle } from '../../components/Decor';
import { ProgressBar } from '../../components/ProgressBar';
import { StatusBadge } from '../../components/StatusBadge';
import { ago, fmtClock, plural } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, spacing } from '../../theme/tokens';

type Attention = { key: string; icon: keyof typeof Ionicons.glyphMap; tone: 'missed' | 'due' | 'expired' | 'lowStock'; text: string };

function attentionItems(card: PatientCard): Attention[] {
  const t = card.today;
  const items: Attention[] = [];
  if (t.missed) items.push({ key: 'missed', icon: 'close-circle', tone: 'missed', text: `${plural(t.missed, 'dose')} missed today` });
  if (t.due) items.push({ key: 'due', icon: 'alarm', tone: 'due', text: `${plural(t.due, 'dose')} due now` });
  for (const m of card.expiringSoon) {
    const d = m.daysToExpiry ?? 0;
    items.push({
      key: `exp-${m.id}`,
      icon: 'warning',
      tone: 'expired',
      text: d < 0 ? `${m.name} has expired` : d === 0 ? `${m.name} expires today` : `${m.name} expires in ${plural(d, 'day')}`,
    });
  }
  for (const m of card.lowStock) {
    items.push({ key: `low-${m.id}`, icon: 'cube', tone: 'lowStock', text: `${m.name}: only ${m.qty} left` });
  }
  return items;
}

/** Home card: who, how today is going (big number), what is next, and what needs attention. */
export function PatientCardView({ card }: { card: PatientCard }) {
  const { colors } = useTheme();
  const t = card.today;
  const done = t.taken + t.late;
  const attention = attentionItems(card);
  const online = card.device?.status === 'online';
  const summary = `${card.displayName}. ${done} of ${t.total} doses taken today. ${attention.length ? `${plural(attention.length, 'thing')} need attention.` : 'All good.'}`;

  return (
    <Card onPress={() => router.push(`/patients/${card.id}`)} accessibilityLabel={`${summary} Open today's doses.`}>
      <View style={styles.header}>
        <Avatar name={card.displayName} />
        <View style={styles.flex}>
          <AppText variant="title">{card.displayName}</AppText>
          <StatusBadge
            status={card.device ? (online ? 'online' : 'offline') : 'offline'}
            label={!card.device ? 'No MIRA yet' : online ? 'MIRA online' : `Offline · ${ago(card.device.lastSeen)}`}
          />
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textMuted} />
      </View>

      {t.total > 0 ? (
        <View style={styles.progress}>
          <View style={styles.bigNumber}>
            <AppText variant="display">{done}</AppText>
            <AppText variant="title" muted>
              {' '}
              of {t.total}
            </AppText>
          </View>
          <ProgressBar done={done} total={t.total} label="doses taken today" />
        </View>
      ) : (
        <AppText muted>No doses scheduled today.</AppText>
      )}

      {card.nextDose ? (
        <View style={[styles.next, { backgroundColor: colors.primarySoft }]}>
          <IconCircle icon="alarm-outline" tone="primary" size={40} />
          <View style={styles.flex}>
            <AppText variant="caption" color={colors.primary}>
              NEXT DOSE
            </AppText>
            <AppText variant="bodyStrong">
              {fmtClock(card.nextDose.time)} · {card.nextDose.medicineName}
            </AppText>
            {card.nextDose.slot ? <AppText muted>Slot {card.nextDose.slot}</AppText> : null}
          </View>
        </View>
      ) : null}

      {attention.length > 0 ? (
        <View style={styles.list}>
          {attention.map((a) => (
            <View key={a.key} style={styles.row}>
              <IconCircle icon={a.icon} tone={a.tone} size={36} />
              <AppText style={styles.flex}>{a.text}</AppText>
            </View>
          ))}
        </View>
      ) : t.total > 0 ? (
        <View style={styles.row}>
          <IconCircle icon="checkmark-circle" tone="taken" size={36} />
          <AppText style={styles.flex}>Nothing needs your attention.</AppText>
        </View>
      ) : null}

      {card.unreadAlerts > 0 ? (
        <AppText variant="bodyStrong" color={colors.primary}>
          {plural(card.unreadAlerts, 'new alert')}
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, gap: 4 },
  progress: { gap: spacing.sm, marginTop: spacing.xs },
  bigNumber: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  next: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
