import type { ExpoConfig } from 'expo/config';

// EXPO_PUBLIC_* values are read at bundle time (docker-compose passes them from .env).
const projectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || undefined;

const config: ExpoConfig = {
  name: 'VOICE',
  slug: 'medrem-caregiver',
  scheme: 'medrem',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.example.medrem',
  },
  android: {
    package: 'com.example.medrem',
    adaptiveIcon: {
      backgroundColor: '#2E4FD8',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow VOICE to use the camera to scan medicine barcodes and take package photos.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    ['expo-notifications', { color: '#2E4FD8', defaultChannel: 'alerts' }],
    '@react-native-community/datetimepicker',
  ],
  experiments: { typedRoutes: false },
  extra: projectId ? { eas: { projectId } } : {},
};

export default config;
