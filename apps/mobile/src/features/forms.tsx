import { Controller, type Control, type FieldPath, type FieldValues, type UseFormSetError } from 'react-hook-form';
import type { TextInputProps } from 'react-native';

import { NumberField, TextField } from '../components/Fields';
import { ApiError } from '../lib/apiError';

type Base<T extends FieldValues> = { control: Control<T>; name: FieldPath<T>; label: string; helper?: string };

/** react-hook-form wrappers so screens never hand-roll field state. */
export function FormTextField<T extends FieldValues>({ control, name, label, helper, ...rest }: Base<T> & TextInputProps) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          helper={helper}
          error={fieldState.error?.message}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          ref={field.ref}
          {...rest}
        />
      )}
    />
  );
}

export function FormNumberField<T extends FieldValues>({ control, name, label, helper, unit }: Base<T> & { unit?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <NumberField
          label={label}
          helper={helper}
          unit={unit}
          error={fieldState.error?.message}
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}

/** Put server validation/conflict errors under the matching field. Returns the message left over. */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fieldMap: Record<string, FieldPath<T>>,
  codeMap: Record<string, FieldPath<T>> = {},
): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  if (codeMap[error.code]) {
    setError(codeMap[error.code], { message: error.message }, { shouldFocus: true });
    return null;
  }
  let placed = false;
  for (const fe of error.fieldErrors) {
    const target = fieldMap[fe.field];
    if (target) {
      setError(target, { message: fe.message }, { shouldFocus: !placed });
      placed = true;
    }
  }
  if (placed) return null;
  if (error.code === 'network') return "We couldn't reach the server. Your changes are still here, try again.";
  return error.message;
}
