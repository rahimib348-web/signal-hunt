import type { ConfigContext, ExpoConfig } from 'expo/config';

// Geheime Schlüssel kommen aus Umgebungsvariablen (.env oder EAS-Secrets),
// nie direkt in den Code.
const googleMapsAndroidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Signal Hunt',
  slug: 'signal-hunt',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'signalhunt',
  userInterfaceStyle: 'dark',
  backgroundColor: '#07090B',
  ios: {
    bundleIdentifier: 'com.rahimib348.signalhunt',
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ['location'],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.rahimib348.signalhunt',
    adaptiveIcon: {
      backgroundColor: '#07090B',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Berechtigungen, die Signal Hunt nicht braucht (weniger Fragen bei der Store-Prüfung).
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#07090B',
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Signal Hunt teilt deinen Standort während einer Runde mit dem Spiel, damit Pings und Spielfeld funktionieren.',
        locationAlwaysAndWhenInUsePermission:
          'Signal Hunt braucht deinen Standort auch bei gesperrtem Bildschirm, damit du während der Runde das Handy in die Tasche stecken kannst. Nach der Runde wird nichts mehr gesendet.',
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Die Kamera wird nur zum Scannen von QR-Codes (Agenten-ID und Spiel-Code) verwendet.',
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // Nur kurze Soundeffekte: kein Mikrofon, kein Abspielen im Hintergrund.
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false }],
    ['react-native-maps', googleMapsAndroidKey ? { androidGoogleMapsApiKey: googleMapsAndroidKey } : {}],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
