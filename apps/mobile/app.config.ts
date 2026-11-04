import type { ExpoConfig } from 'expo/config';

// EXPO_PUBLIC_* values are read at bundle time (docker-compose passes them from .env).
const projectId = process.env.EXPO_PUBLIC_EXPO_PROJECT_ID || undefined;

// Brand colour of the VOICE logo (tools/icons/make_icons.mjs draws every icon from tools/icons/logo-source.png).
const BRAND = '#02547A';

const config: ExpoConfig = {
  name: 'VOICE',
  slug: 'medrem-caregiver',
  scheme: 'medrem',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: BRAND,
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.artistechs.voice',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'com.artistechs.voice',
    adaptiveIcon: {
      backgroundColor: BRAND,
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // The app only needs the camera and notifications; keep the store listing free of anything else.
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: BRAND,
        dark: { image: './assets/splash-icon.png', backgroundColor: BRAND },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow VOICE to use the camera to scan medicine barcodes and take package photos.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: BRAND, defaultChannel: 'alerts' }],
  ],
  experiments: { typedRoutes: false },
  extra: projectId ? { eas: { projectId } } : {},
};

export default config;
