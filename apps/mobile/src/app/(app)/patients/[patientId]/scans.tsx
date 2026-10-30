import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCorrectScan, useMedicines, useScans } from '../../../../api/hooks';
import type { Medicine, Scan } from '../../../../api/types';
import { AppText } from '../../../../components/AppText';
import { AuthImage } from '../../../../components/AuthImage';
import { Button } from '../../../../components/Button';
import { Card } from '../../../../components/Card';
import { ChoiceGroup } from '../../../../components/Fields';
import { Screen } from '../../../../components/Screen';
import { Banner, CardSkeleton, EmptyState, ErrorState, errorMessage } from '../../../../components/States';
import { StatusBadge } from '../../../../components/StatusBadge';
import { ago } from '../../../../lib/format';
import { radius, spacing } from '../../../../theme/tokens';

const METHOD: Record<Scan['method'], string> = {
  barcode: 'by barcode',
  ocr: 'by the printed name',
  embed: 'by how the box looks',
  llm: 'by AI',
  none: '',
};

function ScanCard({ pid, scan, medicines }: { pid: number; scan: Scan; medicines: Medicine[] }) {
  const correct = useCorrectScan(pid);
  const [fixing, setFixing] = useState(false);
  const [choice, setChoice] = useState<number | null>(scan.correctedMedicineId ?? scan.medicineId);
  const corrected = scan.correctedAt !== null;
  const shownMedicine = corrected
    ? scan.correctedNone
      ? null
      : medicines.find((m) => m.id === scan.correctedMedicineId)?.label ?? 'a removed medicine'
    : scan.medicineName;

  return (
    <Card>
      <AuthImage path={scan.imageUrl} style={styles.photo} label={`Camera photo from ${ago(scan.createdAt)}`} />
      <View style={styles.row}>
        {shownMedicine ? (
          <StatusBadge status="taken" label="Identified" />
        ) : (
          <StatusBadge status="due" label="Not recognised" />
        )}
        <AppText muted>{ago(scan.createdAt)}</AppText>
      </View>
      <AppText variant="title">{shownMedicine ?? 'Unknown box'}</AppText>
      {!corrected && scan.found ? <AppText muted>Recognised {METHOD[scan.method]}.</AppText> : null}
      {corrected ? <AppText muted>Corrected by a caregiver.</AppText> : null}
      {scan.ocrExpiry ? <AppText muted>Label says EXP {scan.ocrExpiry} (the date you entered is used).</AppText> : null}
      {correct.isError ? <Banner tone="error" message={errorMessage(correct.error)} /> : null}
      {fixing ? (
        <>
          <ChoiceGroup<number | null>
            label="Which medicine is this?"
            helper="Your answer is saved as a new photo so the camera learns this box."
            value={choice}
            onChange={setChoice}
            choices={[...medicines.map((m) => ({ value: m.id, label: m.label })), { value: null, label: 'None of these' }]}
          />
          <Button
            title="Save answer"
            loading={correct.isPending}
            onPress={async () => {
              await correct.mutateAsync({ scanId: scan.id, medicineId: choice });
              setFixing(false);
            }}
          />
          <Button title="Cancel" variant="ghost" onPress={() => setFixing(false)} />
        </>
      ) : (
        <Button title={shownMedicine ? 'Wrong medicine? Correct it' : 'Tell us which medicine'} variant="secondary" onPress={() => setFixing(true)} />
      )}
    </Card>
  );
}

export default function Scans() {
  const { patientId } = useLocalSearchParams<{ patientId: string }>();
  const pid = Number(patientId);
  const scans = useScans(pid);
  const meds = useMedicines(pid);
  return (
    <Screen refreshing={scans.isRefetching} onRefresh={scans.refetch}>
      <Stack.Screen options={{ title: 'Camera scans' }} />
      <AppText muted>Photos from the pillbox camera button. They are deleted after 30 days.</AppText>
      {scans.isPending || meds.isPending ? (
        <CardSkeleton lines={4} />
      ) : scans.isError ? (
        <ErrorState error={scans.error} onRetry={scans.refetch} />
      ) : scans.data.items.length === 0 ? (
        <EmptyState icon="camera-outline" title="No scans yet" message="When someone presses the CAMERA button on the pillbox, the photo shows here." />
      ) : (
        scans.data.items.map((s) => <ScanCard key={s.id} pid={pid} scan={s} medicines={meds.data ?? []} />)
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between', flexWrap: 'wrap' },
});
