import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useScheduleMutations } from '../../api/hooks';
import type { Medicine, Schedule } from '../../api/types';
import { AppText } from '../../components/AppText';
import { useDialog } from '../../components/Dialog';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceGroup, TimeField } from '../../components/Fields';
import { Banner, errorMessage } from '../../components/States';
import { DAY_NAMES, fmtClock } from '../../lib/format';
import { spacing } from '../../theme/tokens';

const ALL = [0, 1, 2, 3, 4, 5, 6];

function daysText(days: number[]): string {
  if (days.length === 7) return 'Every day';
  return days.map((d) => DAY_NAMES[d]).join(', ');
}

/** Dose times for one medicine. Each time is one pillbox alarm per day. */
export function ScheduleSection({ pid, medicine }: { pid: number; medicine: Medicine }) {
  const m = useScheduleMutations(pid, medicine.id);
  const dialog = useDialog();
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null);
  const [time, setTime] = useState('08:00');
  const [days, setDays] = useState<number[]>(ALL);
  const [error, setError] = useState<string | null>(null);

  const open = (s: Schedule | 'new') => {
    setEditing(s);
    setTime(s === 'new' ? '08:00' : s.time);
    setDays(s === 'new' ? ALL : s.daysOfWeek);
    setError(null);
  };

  const save = async () => {
    if (days.length === 0) {
      setError('Choose at least one day.');
      return;
    }
    try {
      if (editing === 'new') await m.add.mutateAsync({ time, daysOfWeek: days });
      else if (editing) await m.update.mutateAsync({ sid: editing.id, time, daysOfWeek: days });
      setEditing(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = (s: Schedule) =>
    dialog.confirm({
      title: `Remove the ${fmtClock(s.time)} dose?`,
      message: 'VOICE will stop reminding at this time.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
      icon: 'alarm',
      onConfirm: () => m.remove.mutateAsync(s.id),
    });

  return (
    <View style={styles.wrap}>
      <AppText variant="title">Dose times</AppText>
      {!medicine.slot ? (
        <Banner tone="warning" message="This medicine has no VOICE slot, so VOICE will not remind at these times." />
      ) : null}
      {medicine.schedules.length === 0 && editing === null ? <AppText muted>No dose times yet.</AppText> : null}
      {medicine.schedules.map((s) => (
        <Card key={s.id}>
          <AppText variant="title">{fmtClock(s.time)}</AppText>
          <AppText muted>{daysText(s.daysOfWeek)}</AppText>
          <View style={styles.row}>
            <Button title="Change" variant="secondary" onPress={() => open(s)} style={styles.flex} />
            <Button title="Remove" variant="ghost" onPress={() => remove(s)} style={styles.flex} />
          </View>
        </Card>
      ))}
      {editing !== null ? (
        <Card>
          {error ? <Banner tone="error" message={error} /> : null}
          <TimeField label="Time" value={time} onChange={setTime} />
          <ChoiceGroup<number>
            label="Days"
            helper="VOICE currently reminds every day; other days are saved for later."
            multiple
            values={days}
            onToggle={(d) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
            choices={ALL.map((d) => ({ value: d, label: DAY_NAMES[d], hint: undefined }))}
          />
          <Button title="Save time" onPress={save} loading={m.add.isPending || m.update.isPending} />
          <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} />
        </Card>
      ) : (
        <Button title="Add a dose time" icon="add" variant="secondary" onPress={() => open('new')} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
