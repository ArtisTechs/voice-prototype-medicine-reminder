import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { useAlertMutations, useAlerts, useMe } from '../../../api/hooks';
import type { Alert } from '../../../api/types';
import { AppText } from '../../../components/AppText';
import { Button } from '../../../components/Button';
import { IconCircle } from '../../../components/Decor';
import { Screen } from '../../../components/Screen';
import { CardSkeleton, EmptyState, ErrorState } from '../../../components/States';
import { ago } from '../../../lib/format';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, spacing } from '../../../theme/tokens';

const ICON: Record<Alert['type'], keyof typeof Ionicons.glyphMap> = {
  missed: 'close-circle',
  taken: 'checkmark-circle',
  low_stock: 'cube',
  expiry: 'warning',
  expired_dose: 'warning',
  offline: 'cloud-offline',
  scan_unknown: 'help-circle',
};

const TONE: Record<Alert['type'], 'missed' | 'taken' | 'lowStock' | 'expired' | 'due'> = {
  missed: 'missed',
  taken: 'taken',
  low_stock: 'lowStock',
  expiry: 'expired',
  expired_dose: 'expired',
  offline: 'missed',
  scan_unknown: 'due',
};

function AlertRow({ a, onOpen }: { a: Alert; onOpen: () => void }) {
  const { colors, status } = useTheme();
  const tone = status[TONE[a.type]];
  const unread = !a.readAt;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'New. ' : ''}${a.title}. ${a.body}. ${ago(a.createdAt)}.`}
      onPress={onOpen}
      style={[styles.row, { backgroundColor: unread ? tone.bg : colors.surface, borderColor: unread ? tone.fg : 'transparent', borderWidth: unread ? 2 : 1 }]}
    >
      <IconCircle icon={ICON[a.type]} tone={TONE[a.type]} size={44} />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <AppText variant="bodyStrong" style={styles.flex}>
            {a.title}
          </AppText>
          {unread ? (
            <AppText variant="caption" color={tone.fg}>
              NEW
            </AppText>
          ) : null}
        </View>
        <AppText>{a.body}</AppText>
        <AppText variant="caption" muted>
          {ago(a.createdAt)}
        </AppText>
      </View>
    </Pressable>
  );
}

export default function Alerts() {
  const q = useAlerts();
  const m = useAlertMutations();
  useMe();
  const items = q.data?.items ?? [];
  const unread = items.filter((a) => !a.readAt).length;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isPending ? (
        <>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : items.length === 0 ? (
        <EmptyState icon="notifications-off-outline" title="No alerts" message="You will see missed doses, low stock and MIRA problems here." />
      ) : (
        <>
          {unread > 0 ? (
            <Button title={`Mark all ${unread} as read`} variant="secondary" icon="checkmark-done" onPress={() => m.readAll.mutate()} loading={m.readAll.isPending} />
          ) : null}
          {items.map((a) => (
            <AlertRow
              key={a.id}
              a={a}
              onOpen={() => {
                if (!a.readAt) m.read.mutate(a.id);
                const url = a.data?.url;
                if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
              }}
            />
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, alignItems: 'flex-start' },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  flex: { flex: 1 },
});
