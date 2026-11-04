import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import { useDevice } from '../../api/hooks';
import type { Medicine } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { ChoiceGroup, DateField, TextField } from '../../components/Fields';
import { Banner } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { minTouch, spacing } from '../../theme/tokens';
import { applyServerErrors, FormNumberField, FormTextField } from '../forms';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { PhotoCaptureModal } from './PhotoCaptureModal';
import { PhotoReadSheet } from './PhotoReadSheet';
import { VoiceScanSheet, type PackageRead } from './VoiceScanSheet';
import { emptyMedicine, FORMS, fromMedicine, medicineSchema, SERVER_FIELD, UNIT_FOR_FORM, type MedicineFormValues } from './schema';

const FORM_LABEL: Record<(typeof FORMS)[number], string> = { tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid', other: 'Other' };

type Props = {
  medicine?: Medicine;
  /** When set on a new medicine, the form can also be filled by scanning the box on this person's VOICE. */
  patientId?: number;
  /** Other active medicines of this patient, to show which slots are used. */
  others: Medicine[];
  submitLabel: string;
  onSubmit: (values: MedicineFormValues) => Promise<void>;
};

export function MedicineForm({ medicine, patientId, others, submitLabel, onSubmit }: Props) {
  const { colors } = useTheme();
  const [scanning, setScanning] = useState(false);
  const [voiceScan, setVoiceScan] = useState(false);
  const [readNote, setReadNote] = useState<{ text: string; tone: 'info' | 'warning' } | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const device = useDevice(patientId ?? 0);
  const canScanWithVoice = !medicine && !!patientId && !!device.data;
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, setValue, watch, formState } = useForm<MedicineFormValues>({
    resolver: zodResolver(medicineSchema),
    defaultValues: medicine ? fromMedicine(medicine) : emptyMedicine,
    mode: 'onBlur',
  });
  const form = watch('form');
  const unit = UNIT_FOR_FORM[form];
  const usedBy = new Map(others.filter((m) => m.slot && m.id !== medicine?.id).map((m) => [m.slot as number, m.label]));

  /** Fill the form from what was read on a box (VOICE or phone photo). A guess is labelled as one. */
  const applyRead = (r: PackageRead) => {
    const opts = { shouldValidate: true, shouldDirty: true };
    setValue('name', r.name, opts);
    if (r.strength) setValue('strength', r.strength, opts);
    if (r.expiry) setValue('expiryDate', r.expiry, opts);
    const what = [r.name, r.strength].filter(Boolean).join(' ');
    setReadNote(
      r.guessed
        ? { tone: 'warning', text: `The name was not readable, so this is a guess from how the box looks: ${what}. Please check it carefully before saving.` }
        : { tone: 'info', text: `Read from the box: ${what}. Please check the details before saving.` },
    );
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setFormError(applyServerErrors(e, setError, SERVER_FIELD, { slot_taken: 'slot' }));
    }
  });

  return (
    <View style={styles.form}>
      {formError ? <Banner tone="error" message={formError} /> : null}
      {!medicine ? (
        <View style={styles.gap}>
          <AppText variant="title">Scan it to fill this in</AppText>
          {canScanWithVoice ? <Button title="Scan the box with VOICE" icon="scan" onPress={() => setVoiceScan(true)} /> : null}
          {patientId ? <Button title="Take a photo of the box" icon="camera" variant="secondary" onPress={() => setCameraOpen(true)} /> : null}
          <Button title="Scan the barcode with this phone" icon="barcode" variant="secondary" onPress={() => setScanning(true)} />
          <AppText muted>Or fill in the details below by hand.</AppText>
        </View>
      ) : null}
      {readNote ? <Banner tone={readNote.tone} message={readNote.text} /> : null}
      <FormTextField control={control} name="name" label="Medicine name" helper='As written on the box, e.g. "Losartan".' autoCapitalize="words" />
      <FormTextField control={control} name="strength" label="Strength (optional)" helper='e.g. "50mg".' autoCapitalize="none" />
      <Controller
        control={control}
        name="form"
        render={({ field }) => (
          <ChoiceGroup
            label="Form"
            value={field.value}
            onChange={field.onChange}
            choices={FORMS.map((f) => ({ value: f, label: FORM_LABEL[f] }))}
          />
        )}
      />
      <FormNumberField control={control} name="doseAmount" label="How much per dose" unit={`${unit}(s)`} />
      <FormTextField control={control} name="instructions" label="Instructions (optional)" helper='Short, e.g. "After breakfast". VOICE shows the first 39 letters.' multiline />

      <Controller
        control={control}
        name="slot"
        render={({ field, fieldState }) => (
          <ChoiceGroup<number | null>
            label="VOICE slot"
            helper="The compartment this medicine goes in. Without a slot VOICE will not remind."
            error={fieldState.error?.message}
            value={field.value}
            onChange={field.onChange}
            choices={[
              { value: null, label: 'None' },
              ...[1, 2, 3, 4, 5].map((n) => ({
                value: n,
                label: String(n),
                disabled: usedBy.has(n),
                hint: usedBy.has(n) ? `used by ${usedBy.get(n)}` : undefined,
              })),
            ]}
          />
        )}
      />

      <Controller
        control={control}
        name="barcode"
        render={({ field, fieldState }) => (
          <View style={styles.gap}>
            <TextField
              label="Barcode (optional)"
              helper="Scan it with the camera or type the numbers under the lines."
              error={fieldState.error?.message}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              keyboardType="number-pad"
            />
            <Button title="Scan barcode with camera" variant="secondary" icon="barcode" onPress={() => setScanning(true)} />
          </View>
        )}
      />
      {patientId ? (
        <VoiceScanSheet
          visible={voiceScan}
          patientId={patientId}
          onClose={() => setVoiceScan(false)}
          onRead={(r) => {
            applyRead(r);
            setVoiceScan(false);
          }}
        />
      ) : null}
      {patientId ? (
        <>
          <PhotoCaptureModal
            visible={cameraOpen}
            angle="front"
            title="Photo of the box"
            hint="Hold the side with the medicine name printed on it, in good light. The photo is only read, not saved."
            onClose={() => setCameraOpen(false)}
            onCaptured={(uri) => {
              setCameraOpen(false);
              setPhotoUri(uri);
            }}
          />
          <PhotoReadSheet
            uri={photoUri}
            patientId={patientId}
            onClose={() => setPhotoUri(null)}
            onRetake={() => {
              setPhotoUri(null);
              setCameraOpen(true);
            }}
            onRead={(r) => {
              applyRead(r);
              setPhotoUri(null);
            }}
          />
        </>
      ) : null}
      <BarcodeScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(code) => {
          setValue('barcode', code, { shouldValidate: true, shouldDirty: true });
          setReadNote({ tone: 'info', text: `Barcode ${code} filled in below. Add the medicine name and the other details.` });
          setScanning(false);
        }}
      />

      <Controller
        control={control}
        name="expiryDate"
        render={({ field, fieldState }) => (
          <DateField label="Expiry date" helper="Printed on the box (EXP)." value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />

      <AppText variant="title" style={styles.section}>
        Stock
      </AppText>
      <FormNumberField control={control} name="qty" label="Pills in the box now" unit={`${unit}(s)`} />
      <FormNumberField control={control} name="lowStockThreshold" label="Warn me when this many are left" unit={`${unit}(s)`} />
      <FormNumberField control={control} name="refillLeadDays" label="Remind me to refill this many days before running out" unit="days" />

      <Button title={submitLabel} onPress={() => submit()} loading={formState.isSubmitting} />
      {Object.keys(formState.errors).length > 0 ? (
        <View style={styles.hint} accessibilityLiveRegion="polite">
          <AppText color={colors.danger}>Please fix the fields marked in red.</AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  gap: { gap: spacing.sm },
  section: { marginTop: spacing.sm },
  hint: { minHeight: minTouch, justifyContent: 'center' },
});
