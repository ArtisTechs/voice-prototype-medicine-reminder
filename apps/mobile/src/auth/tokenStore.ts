import * as SecureStore from 'expo-secure-store';

const ACCESS = 'medrem.access';
const REFRESH = 'medrem.refresh';

export type Tokens = { accessToken: string; refreshToken: string };

let cache: Tokens | null | undefined;

export async function loadTokens(): Promise<Tokens | null> {
  if (cache !== undefined) return cache;
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
  ]);
  cache = accessToken && refreshToken ? { accessToken, refreshToken } : null;
  return cache;
}

export async function saveTokens(t: Tokens): Promise<void> {
  cache = t;
  await Promise.all([SecureStore.setItemAsync(ACCESS, t.accessToken), SecureStore.setItemAsync(REFRESH, t.refreshToken)]);
}

export async function clearTokens(): Promise<void> {
  cache = null;
  await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
}

export function resetTokenCache(): void {
  cache = undefined;
}
