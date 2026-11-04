import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import WheelPicker from '@quidone/react-native-wheel-picker';
import { Pressable, StyleSheet, View } from 'react-native';

import { DAY_NAMES, isoDay } from '../lib/format';
import { useTheme } from '../theme/ThemeProvider';
import { minTouch, radius, spacing } from '../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';
import { Sheet } from './Sheet';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ArrowButton({ icon, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={[styles.arrow, { backgroundColor: colors.primarySoft, opacity: disabled ? 0.4 : 1 }]}
    >
      <Ionicons name={icon} size={24} color={colors.primary} />
    </Pressable>
  );
}

/** Month calendar in a bottom sheet. value / onPick use "YYYY-MM-DD". */
export function DatePickerSheet({
  visible,
  value,
  minimumDate,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: string | null | undefined;
  minimumDate?: Date;
  onPick: (isoDate: string) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const start = value ? new Date(`${value}T12:00:00`) : new Date();
  const [year, setYear] = useState(start.getFullYear());
  const [month, setMonth] = useState(start.getMonth());
  const [selected, setSelected] = useState<string | null>(value ?? null);

  // Re-open on the chosen date (or today).
  useEffect(() => {
    if (!visible) return;
    const d = value ? new Date(`${value}T12:00:00`) : new Date();
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setSelected(value ?? null);
  }, [visible, value]);

  const today = isoDay(new Date());
  const min = minimumDate ? isoDay(minimumDate) : null;

  const cells = useMemo(() => {
    const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Monday first
    const count = new Date(year, month + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= count; d++) out.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    while (out.length % 7) out.push(null);
    return out;
  }, [year, month]);

  const shift = (months: number) => {
    const d = new Date(year, month + months, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };
  const prevDisabled = min ? isoDay(new Date(year, month, 0)) < min : false;

  return (
    <Sheet visible={visible} title="Choose a date" onClose={onClose}>
      <View style={styles.monthRow}>
        <ArrowButton icon="chevron-back" label="Previous month" onPress={() => shift(-1)} disabled={prevDisabled} />
        <AppText variant="bodyStrong" accessibilityLiveRegion="polite" style={styles.monthTitle}>
          {MONTHS[month]} {year}
        </AppText>
        <ArrowButton icon="chevron-forward" label="Next month" onPress={() => shift(1)} />
      </View>
      <View style={styles.yearRow}>
        <Button title="− 1 year" variant="ghost" onPress={() => shift(-12)} disabled={min ? `${year - 1}-12-31` < min : false} style={styles.flex} />
        <Button title="+ 1 year" variant="ghost" onPress={() => shift(12)} style={styles.flex} />
      </View>
      <View style={styles.weekRow} importantForAccessibility="no-hide-descendants">
        {DAY_NAMES.map((n) => (
          <AppText key={n} muted style={styles.weekday}>
            {n[0]}
          </AppText>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((iso, i) => {
          if (!iso) return <View key={`blank-${i}`} style={styles.cell} />;
          const isSel = iso === selected;
          const disabled = !!min && iso < min;
          return (
            <Pressable
              key={iso}
              accessibilityRole="button"
              accessibilityLabel={`${MONTHS[month]} ${Number(iso.slice(8))}, ${year}${iso === today ? ', today' : ''}`}
              accessibilityState={{ selected: isSel, disabled }}
              disabled={disabled}
              onPress={() => setSelected(iso)}
              style={[
                styles.cell,
                styles.day,
                { backgroundColor: isSel ? colors.primary : 'transparent', borderColor: iso === today && !isSel ? colors.primary : 'transparent', opacity: disabled ? 0.35 : 1 },
              ]}
            >
              <AppText variant="bodyStrong" color={isSel ? colors.onPrimary : colors.text}>
                {Number(iso.slice(8))}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.actions}>
        <Button title="Done" icon="checkmark" disabled={!selected} onPress={() => selected && onPick(selected)} />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const HOUR_ITEMS = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
const MINUTE_ITEMS = Array.from({ length: 60 }, (_, i) => ({ value: i, label: String(i).padStart(2, '0') }));
const AMPM_ITEMS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
];

/** Scrolling wheels for hour, minute (every minute) and AM/PM in a bottom sheet. value / onPick use "HH:MM" (24 h). */
export function TimePickerSheet({ visible, value, onPick, onClose }: { visible: boolean; value: string; onPick: (hhmm: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  const [h24, m0] = (value || '08:00').split(':').map(Number);
  const [hour, setHour] = useState(h24 % 12 || 12);
  const [minute, setMinute] = useState(m0);
  const [ampm, setAmpm] = useState(h24 >= 12 ? 'PM' : 'AM');

  useEffect(() => {
    if (!visible) return;
    const [h, m] = (value || '08:00').split(':').map(Number);
    setHour(h % 12 || 12);
    setMinute(m);
    setAmpm(h >= 12 ? 'PM' : 'AM');
  }, [visible, value]);

  const result = `${String((hour % 12) + (ampm === 'PM' ? 12 : 0)).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const nudge = (delta: number) => {
    // Fine-tuning by one minute for people who find the wheels fiddly (and for screen readers).
    const total = (((hour % 12) + (ampm === 'PM' ? 12 : 0)) * 60 + minute + delta + 1440) % 1440;
    const h = Math.floor(total / 60);
    setHour(h % 12 || 12);
    setMinute(total % 60);
    setAmpm(h >= 12 ? 'PM' : 'AM');
  };
  const wheel = {
    itemHeight: 52,
    visibleItemCount: 5,
    width: 92,
    itemTextStyle: { fontSize: 26, fontWeight: '600' as const, color: colors.text },
    overlayItemStyle: { backgroundColor: colors.primarySoft, borderRadius: radius.md },
  };

  return (
    <Sheet visible={visible} title="Choose a time" onClose={onClose}>
      <AppText variant="display" style={styles.preview} accessibilityLiveRegion="polite" color={colors.primary}>
        {hour}:{String(minute).padStart(2, '0')} {ampm}
      </AppText>
      <View style={styles.wheels}>
        <WheelPicker {...wheel} data={HOUR_ITEMS} value={hour} onValueChanged={({ item }) => setHour(item.value)} enableScrollByTapOnItem />
        <AppText variant="headline">:</AppText>
        <WheelPicker {...wheel} data={MINUTE_ITEMS} value={minute} onValueChanged={({ item }) => setMinute(item.value)} enableScrollByTapOnItem />
        <WheelPicker {...wheel} data={AMPM_ITEMS} value={ampm} onValueChanged={({ item }) => setAmpm(item.value)} enableScrollByTapOnItem />
      </View>
      <View style={styles.yearRow}>
        <Button title="− 1 minute" variant="ghost" onPress={() => nudge(-1)} style={styles.flex} />
        <Button title="+ 1 minute" variant="ghost" onPress={() => nudge(1)} style={styles.flex} />
      </View>
      <View style={styles.actions}>
        <Button title="Done" icon="checkmark" onPress={() => onPick(result)} />
        <Button title="Cancel" variant="secondary" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { flex: 1, textAlign: 'center' },
  arrow: { width: minTouch, height: minTouch, borderRadius: minTouch / 2, alignItems: 'center', justifyContent: 'center' },
  yearRow: { flexDirection: 'row', gap: spacing.sm },
  weekRow: { flexDirection: 'row' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, height: minTouch, alignItems: 'center', justifyContent: 'center' },
  day: { borderRadius: radius.md, borderWidth: 2 },
  wheels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preview: { textAlign: 'center' },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
});
