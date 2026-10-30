import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { makeQueryClient, wireFocusManager } from '../api/queryClient';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

function RootStack() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerTitleStyle: { fontSize: 20, fontWeight: '600' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Pillbox Care' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [client] = useState(makeQueryClient);
  useEffect(() => wireFocusManager(), []);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <RootStack />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
