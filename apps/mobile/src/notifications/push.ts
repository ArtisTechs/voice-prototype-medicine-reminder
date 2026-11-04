import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { api } from '../api/client';

const TOKEN_KEY = 'medrem.pushToken';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    // In the app, the custom in-app banner (NotificationsBridge) shows alerts; the system banner only appears when the app is closed.
    shouldShowBanner: false,
    shouldShowList: true,
  }),
});

/** Expo Go cannot receive remote push on Android (SDK 53+); in-app alerts still come over WebSocket. */
export function pushSupported(): boolean {
  const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return Device.isDevice && !(expoGo && Platform.OS === 'android');
}

function projectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined
  );
}

export async function ensureChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    // Create the channel before asking for a token, or Android 13+ never shows the prompt.
    await Notifications.setNotificationChannelAsync('alerts', {
      name: 'Medicine alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 300, 200, 300],
    });
  }
}

export type PushState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

export async function permissionState(): Promise<PushState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return 'granted';
  return p.canAskAgain ? 'undetermined' : 'denied';
}

/** Ask (if allowed), get the Expo push token, and register it with the backend. */
export async function registerForPush(ask: boolean): Promise<PushState> {
  await ensureChannel();
  let state = await permissionState();
  if (state === 'undetermined' && ask) {
    state = (await Notifications.requestPermissionsAsync()).granted ? 'granted' : 'denied';
  }
  if (state !== 'granted') return state;
  if (!pushSupported()) return 'unsupported';
  const id = projectId();
  if (!id) return 'unsupported'; // a dev-client build with EXPO_PUBLIC_EXPO_PROJECT_ID is needed
  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await api('/api/v1/me/push-tokens', { method: 'POST', body: { token, platform: Platform.OS } });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch {
    return 'unsupported';
  }
  return 'granted';
}

export async function storedPushToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function forgetPushToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
