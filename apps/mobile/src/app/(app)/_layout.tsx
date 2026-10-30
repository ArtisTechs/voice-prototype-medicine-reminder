import { Stack } from 'expo-router';

import { NotificationsBridge } from '../../notifications/NotificationsBridge';
import { RealtimeProvider } from '../../realtime/RealtimeProvider';
import { useTheme } from '../../theme/ThemeProvider';

export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  const { colors } = useTheme();
  return (
    <RealtimeProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 20, fontWeight: '600' },
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="patients/new" options={{ title: 'Add a person' }} />
        <Stack.Screen name="patients/join" options={{ title: 'Join with a code' }} />
      </Stack>
      {/* After the Stack so the in-app alert banner draws on top. */}
      <NotificationsBridge />
    </RealtimeProvider>
  );
}
