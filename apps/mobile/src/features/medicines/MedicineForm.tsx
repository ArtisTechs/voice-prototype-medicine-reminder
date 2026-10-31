import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';

import type { Medicine } from '../../api/types';
import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { ChoiceGroup, DateField, TextField } from '../../components/Fields';
import { Banner } from '../../components/States';
import { useTheme } from '../../theme/ThemeProvider';
import { minTouch, spacing } from '../../theme/tokens';
import { applyServerErrors, FormNumberField, FormTextField } from '../forms';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { emptyMedicine, FORMS, fromMedicine, medicineSchema, SERVER_FIELD, UNIT_FOR_FORM, type MedicineFormValues } from './schema';

const FORM_LABEL: Record<(typeof FORMS)[number], string> = { tablet: 'Tablet', capsule: 'Capsule', liquid: 'Liquid', other: 'Other' };

type Props = {
  medicine?: Medicine;
  /** Other active medicines of this patient, to show which slots are used. */
  others: Medicine[];
  submitLabel: string;
  onSubmit: (values: MedicineFormValues) => Promise<void>;
};

export function MedicineForm({ medicine, others, submitLabel, onSubmit }: Props) {
  const { colors } = useTheme();
  const [scanning, setScanning] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { control, handleSubmit, setError, setValue, watch, formState } = useForm<MedicineFormValues>({
    resolver: zodResolver(medicineSchema),
    defaultValues: medicine ? fromMedicine(medicine) : emptyMedicine,
    mode: 'onBlur',
  });
  const form = watch('form');
  const unit = UNIT_FOR_FORM[form];
  const usedBy = new Map(others.filter((m) => m.slot && m.id !== medicine?.id).map((m) => [m.slot as number, m.label]));

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
      <BarcodeScannerModal
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(code) => {
          setValue('barcode', code, { shouldValidate: true, shouldDirty: true });
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
