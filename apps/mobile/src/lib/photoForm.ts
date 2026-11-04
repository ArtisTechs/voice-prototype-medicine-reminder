/**
 * A multipart body holding one photo from the phone. React Native's older `{ uri, name, type }` form part is
 * rejected by Expo's fetch ("Unsupported FormDataPart implementation"): it wants a real Blob, so read the file first.
 */
export async function photoForm(uri: string, name: string, extra: Record<string, string> = {}): Promise<FormData> {
  const blob = await (await fetch(uri)).blob();
  const form = new FormData();
  form.append('file', blob, name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}
