import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../api/client';
import { qk } from '../api/keys';
import type { Alert, Page } from '../api/types';
import { AppText } from '../components/AppText';
import { useRealtime } from '../realtime/RealtimeProvider';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { registerForPush } from './push';

function openUrl(url: unknown) {
  if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
}

/** Push registration, notification taps, and an in-app banner for realtime alerts (works in Expo Go). */
export function NotificationsBridge() {
  const qc = useQueryClient();
  const { lastAlertAt } = useRealtime();
  const { status, colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Alert | null>(null);
  const seen = useRef<number>(0);

  // Register silently when permission was already given (the Settings/Home banner asks).
  useEffect(() => {
    registerForPush(false).catch(() => {});
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      openUrl(r.notification.request.content.data?.url);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!lastAlertAt) return;
    qc.fetchQuery({ queryKey: qk.alerts(), queryFn: () => api<Page<Alert>>('/api/v1/alerts', { query: { limit: 100 } }) })
      .then((page) => {
        const newest = page.items.find((a) => !a.readAt && a.type !== 'taken') ?? page.items[0];
        if (!newest || newest.id <= seen.current) return;
        seen.current = newest.id;
        setToast(newest);
        AccessibilityInfo.announceForAccessibility(`${newest.title}. ${newest.body}`);
      })
      .catch(() => {});
  }, [lastAlertAt, qc]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;
  const tone = toast.severity === 'high' ? status.missed : toast.type === 'taken' ? status.taken : status.due;
  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLabel={`${toast.title}. ${toast.body}. Double tap to open.`}
      onPress={() => {
        setToast(null);
        openUrl(toast.data?.url ?? '/alerts');
      }}
      style={[styles.toast, { top: insets.top + spacing.sm, backgroundColor: tone.bg, borderColor: tone.fg, shadowColor: colors.text }]}
    >
      <Ionicons name={toast.severity === 'high' ? 'alert-circle' : 'notifications'} size={28} color={tone.fg} />
      <AppText variant="bodyStrong" color={tone.fg} style={styles.flex}>
        {toast.title}
        {'\n'}
        <AppText color={tone.fg}>{toast.body}</AppText>
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    zIndex: 100,
    elevation: 6,
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
  },
  flex: { flex: 1 },
});
