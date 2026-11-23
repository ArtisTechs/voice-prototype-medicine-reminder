import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { ApiError } from '../lib/apiError';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

type EmptyProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({ icon = 'leaf-outline', title, message, actionLabel, onAction }: EmptyProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityRole="summary">
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={40} color={colors.primary} />
      </View>
      <AppText variant="title" style={styles.text}>
        {title}
      </AppText>
      {message ? (
        <AppText muted style={styles.text}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button title={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'network') return "We couldn't reach the MIRA server. Check your internet, then try again. It can take a minute to wake up.";
    return error.message;
  }
  return 'Something went wrong.';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={48} color={colors.danger} />
      <AppText variant="title" style={styles.text}>
        Could not load this
      </AppText>
      <AppText muted style={styles.text}>
        {errorMessage(error)}
      </AppText>
      <Button title="Try again" icon="refresh" onPress={onRetry} />
    </View>
  );
}

/** Pulsing placeholder shaped like the content it replaces. */
export function Skeleton({ height = 20, width = '100%' as const }: { height?: number; width?: number | `${number}%` }) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ height, width, opacity, backgroundColor: colors.skeleton, borderRadius: radius.sm }}
    />
  );
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityLabel="Loading"
      style={[styles.skeletonCard, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <Skeleton height={24} width="60%" />
      {Array.from({ length: lines - 1 }, (_, i) => (
        <Skeleton key={i} height={18} width={i % 2 ? '80%' : '100%'} />
      ))}
    </View>
  );
}

export function Banner({ tone = 'warning', message }: { tone?: 'warning' | 'error' | 'info'; message: string }) {
  const { status, colors } = useTheme();
  const t = tone === 'error' ? status.missed : tone === 'warning' ? status.due : { fg: colors.text, bg: colors.surfaceAlt };
  const icon = tone === 'error' ? 'cloud-offline' : tone === 'warning' ? 'warning' : 'information-circle';
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: t.bg, borderColor: t.fg }]}>
      <Ionicons name={icon} size={22} color={t.fg} />
      <AppText color={t.fg} style={styles.flex}>
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  text: { textAlign: 'center' },
  skeletonCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  flex: { flex: 1 },
});
