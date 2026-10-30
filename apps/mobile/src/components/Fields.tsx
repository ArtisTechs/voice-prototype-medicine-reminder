import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import type { ComponentProps } from 'react';

import { fmtClock, fmtLongDate, isoDay } from '../lib/format';
import { useTheme } from '../theme/ThemeProvider';
import { minTouch, radius, spacing, type } from '../theme/tokens';
import { AppText } from './AppText';

type FieldShellProps = { label: string; helper?: string; error?: string; children: ReactNode; trailing?: ReactNode };

/** Label always visible above, helper and error below (never placeholder-only). */
export function FieldShell({ label, helper, error, children, trailing }: FieldShellProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <AppText variant="bodyStrong">{label}</AppText>
        {trailing}
      </View>
      {children}
      {error ? (
        <View style={styles.errorRow} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={20} color={colors.danger} />
          <AppText variant="body" color={colors.danger} style={styles.flex}>
            {error}
          </AppText>
        </View>
      ) : helper ? (
        <AppText variant="caption" muted>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

type TextFieldProps = TextInputProps & { label: string; helper?: string; error?: string; unit?: string; ref?: ComponentProps<typeof TextInput>['ref'] };

export function TextField({ label, helper, error, unit, style, ref, ...rest }: TextFieldProps) {
  const { colors } = useTheme();
  return (
    <FieldShell label={label} helper={helper} error={error}>
      <View
        style={[
          styles.inputBox,
          { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface },
        ]}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={helper}
          placeholderTextColor={colors.textMuted}
          style={[type.body, styles.input, { color: colors.text }, style]}
          {...rest}
        />
        {unit ? <AppText muted>{unit}</AppText> : null}
      </View>
    </FieldShell>
  );
}

type NumberFieldProps = Omit<TextFieldProps, 'value' | 'onChangeText'> & {
  value: number | undefined | null;
  onChange: (v: number | undefined) => void;
};

export function NumberField({ value, onChange, ...rest }: NumberFieldProps) {
  return (
    <TextField
      keyboardType="number-pad"
      inputMode="numeric"
      value={value === undefined || value === null || Number.isNaN(value) ? '' : String(value)}
      onChangeText={(t) => {
        const digits = t.replace(/[^0-9]/g, '');
        onChange(digits === '' ? undefined : Number(digits));
      }}
      {...rest}
    />
  );
}

type PickerButtonProps = { label: string; value: string; placeholder: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; error?: string; helper?: string; onClear?: () => void };

function PickerButton({ label, value, placeholder, icon, onPress, error, helper, onClear }: PickerButtonProps) {
  const { colors } = useTheme();
  return (
    <FieldShell
      label={label}
      error={error}
      helper={helper}
      trailing={
        onClear && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={onClear} hitSlop={12} style={styles.clear}>
            <AppText color={colors.primary}>Clear</AppText>
          </Pressable>
        ) : null
      }
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value || placeholder}. Double tap to change.`}
        onPress={onPress}
        style={[styles.inputBox, { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface }]}
      >
        <Ionicons name={icon} size={22} color={colors.primary} />
        <AppText style={styles.flex} muted={!value}>
          {value || placeholder}
        </AppText>
      </Pressable>
    </FieldShell>
  );
}

/** Date picker (never free typing). value/onChange use "YYYY-MM-DD". */
export function DateField({
  label,
  value,
  onChange,
  error,
  helper,
  minimumDate,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  error?: string;
  helper?: string;
  minimumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const current = value ? new Date(`${value}T12:00:00`) : new Date();
  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    setOpen(Platform.OS === 'ios');
    if (e.type === 'set' && d) onChange(isoDay(d));
  };
  return (
    <>
      <PickerButton
        label={label}
        value={value ? fmtLongDate(value) : ''}
        placeholder="Choose a date"
        icon="calendar"
        onPress={() => setOpen(true)}
        onClear={() => onChange(null)}
        error={error}
        helper={helper}
      />
      {open ? (
        <DateTimePicker value={current} mode="date" minimumDate={minimumDate} onChange={onPick} />
      ) : null}
    </>
  );
}

/** Time picker. value/onChange use "HH:MM" (24 h, sent to the API); shown as 8:00 AM. */
export function TimeField({ label, value, onChange, error }: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const [open, setOpen] = useState(false);
  const [h, m] = (value || '08:00').split(':').map(Number);
  const current = new Date();
  current.setHours(h, m, 0, 0);
  return (
    <>
      <PickerButton label={label} value={value ? fmtClock(value) : ''} placeholder="Choose a time" icon="time" onPress={() => setOpen(true)} error={error} />
      {open ? (
        <DateTimePicker
          value={current}
          mode="time"
          minuteInterval={5}
          onChange={(e, d) => {
            setOpen(Platform.OS === 'ios');
            if (e.type === 'set' && d) onChange(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
          }}
        />
      ) : null}
    </>
  );
}

type Choice<T> = { value: T; label: string; disabled?: boolean; hint?: string };

/** Big toggle buttons for small fixed sets (slots, forms, days). */
export function ChoiceGroup<T extends string | number | null>({
  label,
  choices,
  value,
  onChange,
  error,
  helper,
  multiple,
  values,
  onToggle,
}: {
  label: string;
  choices: Choice<T>[];
  value?: T;
  onChange?: (v: T) => void;
  error?: string;
  helper?: string;
  multiple?: boolean;
  values?: T[];
  onToggle?: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <FieldShell label={label} error={error} helper={helper}>
      <View style={styles.choices} accessibilityRole={multiple ? undefined : 'radiogroup'}>
        {choices.map((c) => {
          const selected = multiple ? !!values?.includes(c.value) : value === c.value;
          return (
            <Pressable
              key={String(c.value)}
              accessibilityRole={multiple ? 'checkbox' : 'radio'}
              accessibilityState={{ selected, checked: selected, disabled: c.disabled }}
              accessibilityLabel={c.hint ? `${c.label}, ${c.hint}` : c.label}
              disabled={c.disabled}
              onPress={() => (multiple ? onToggle?.(c.value) : onChange?.(c.value))}
              style={[
                styles.choice,
                {
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.surface,
                  opacity: c.disabled ? 0.5 : 1,
                },
              ]}
            >
              {selected ? <Ionicons name="checkmark" size={18} color={colors.onPrimary} /> : null}
              <AppText variant="bodyStrong" color={selected ? colors.onPrimary : colors.text}>
                {c.label}
              </AppText>
              {c.hint ? (
                <AppText variant="caption" color={selected ? colors.onPrimary : colors.textMuted}>
                  {c.hint}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </FieldShell>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inputBox: {
    minHeight: minTouch + 4,
    borderWidth: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: { flex: 1, paddingVertical: spacing.sm },
  errorRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'flex-start' },
  flex: { flex: 1 },
  clear: { minHeight: minTouch, justifyContent: 'center' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: minTouch,
    minWidth: minTouch,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
});
