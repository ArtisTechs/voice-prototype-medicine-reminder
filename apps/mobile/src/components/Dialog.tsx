import Ionicons from '@expo/vector-icons/Ionicons';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { errorMessage } from './States';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

type Tone = 'danger' | 'primary' | 'warning';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** danger = red button and a bin/warning icon; primary = a normal question. */
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Runs when the person confirms. The dialog shows a spinner meanwhile, closes on success, and shows the error inside itself when it throws. */
  onConfirm?: () => void | Promise<unknown>;
};

type NoticeOptions = { title: string; message?: string; tone?: Tone; icon?: keyof typeof Ionicons.glyphMap; okLabel?: string };

type Active =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'notice' } & NoticeOptions);

type DialogApi = {
  confirm: (opts: ConfirmOptions) => void;
  notify: (opts: NoticeOptions) => void;
};

const DialogContext = createContext<DialogApi | null>(null);

/** Replaces the system Alert: same look in both themes, big buttons, shows progress and errors. */
export function useDialog(): DialogApi {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog needs <DialogProvider>');
  return ctx;
}

const DEFAULT_ICON: Record<Tone, keyof typeof Ionicons.glyphMap> = {
  danger: 'trash',
  warning: 'warning',
  primary: 'help-circle',
};

export function DialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  const close = useCallback(() => {
    setActive(null);
    setBusy(false);
    setError(null);
    busyRef.current = false;
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (opts) => {
        setError(null);
        setActive({ kind: 'confirm', ...opts });
      },
      notify: (opts) => {
        setError(null);
        setActive({ kind: 'notice', ...opts });
      },
    }),
    [],
  );

  const onConfirm = async () => {
    if (!active || active.kind !== 'confirm' || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await active.onConfirm?.();
      close();
    } catch (e) {
      busyRef.current = false;
      setBusy(false);
      setError(errorMessage(e));
    }
  };

  const cancel = () => {
    if (!busyRef.current) close();
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      <DialogView active={active} busy={busy} error={error} onConfirm={onConfirm} onCancel={cancel} />
    </DialogContext.Provider>
  );
}

function DialogView({
  active,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  active: Active | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { colors, scheme } = useTheme();
  if (!active) return null;
  const tone: Tone = active.tone ?? (active.kind === 'confirm' ? 'primary' : 'primary');
  const tint = tone === 'danger' ? colors.danger : tone === 'warning' ? '#A04500' : colors.primary;
  const tintBg = tone === 'danger' ? (scheme === 'dark' ? '#3B1412' : '#FDE7E5') : tone === 'warning' ? (scheme === 'dark' ? '#3A2210' : '#FFE9D9') : colors.primarySoft;
  const icon = active.icon ?? DEFAULT_ICON[active.kind === 'notice' && !active.tone ? 'primary' : tone];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: 'rgba(8, 20, 30, 0.6)' }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Close" accessibilityRole="button" />
        <View
          accessibilityViewIsModal
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.iconCircle, { backgroundColor: tintBg }]} importantForAccessibility="no-hide-descendants">
            <Ionicons name={active.kind === 'notice' && !active.icon && !active.tone ? 'information-circle' : icon} size={32} color={tint} />
          </View>
          <AppText variant="title" style={styles.center} accessibilityRole="header">
            {active.title}
          </AppText>
          {active.message ? (
            <AppText muted style={styles.center}>
              {active.message}
            </AppText>
          ) : null}
          {error ? (
            <View style={[styles.error, { backgroundColor: scheme === 'dark' ? '#3B1412' : '#FDE7E5' }]} accessibilityLiveRegion="polite">
              <Ionicons name="alert-circle" size={20} color={colors.danger} />
              <AppText color={colors.danger} style={styles.flex}>
                {error}
              </AppText>
            </View>
          ) : null}
          <View style={styles.actions}>
            {active.kind === 'confirm' ? (
              <>
                <Button
                  title={error ? 'Try again' : active.confirmLabel}
                  variant={tone === 'danger' ? 'danger' : 'primary'}
                  loading={busy}
                  onPress={onConfirm}
                />
                <Button title={active.cancelLabel ?? 'Cancel'} variant="secondary" disabled={busy} onPress={onCancel} />
              </>
            ) : (
              <Button title={active.okLabel ?? 'OK'} onPress={onCancel} />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.md,
    alignItems: 'stretch',
  },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  error: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
