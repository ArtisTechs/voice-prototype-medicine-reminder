import { File } from 'expo-file-system';

/**
 * A multipart body holding one photo from the phone. React Native's older `{ uri, name, type }` form part is
 * rejected by Expo's fetch ("Unsupported FormDataPart implementation"), and `fetch(uri).blob()` can come back empty
 * (the server then sees no file). Expo's `File` is a real Blob that reads the file itself.
 */
export function photoForm(uri: string, name: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append('file', new File(uri), name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}
