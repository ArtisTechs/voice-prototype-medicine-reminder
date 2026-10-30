import { Image, type ImageStyle } from 'expo-image';
import { useEffect, useState } from 'react';
import type { StyleProp } from 'react-native';

import { fileUrl } from '../api/client';
import { loadTokens } from '../auth/tokenStore';
import { useTheme } from '../theme/ThemeProvider';

/** Images behind the API need the bearer token (scan photos, reference photos). */
export function AuthImage({ path, style, label }: { path: string; style?: StyleProp<ImageStyle>; label: string }) {
  const [token, setToken] = useState<string | null>(null);
  const { colors } = useTheme();
  useEffect(() => {
    loadTokens().then((t) => setToken(t?.accessToken ?? null));
  }, []);
  if (!token) return null;
  return (
    <Image
      source={{ uri: fileUrl(path), headers: { Authorization: `Bearer ${token}` } }}
      style={[{ backgroundColor: colors.surfaceAlt }, style]}
      contentFit="cover"
      accessibilityLabel={label}
      transition={150}
    />
  );
}
