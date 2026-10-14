import type { CapacitorConfig } from '@capacitor/cli';

// The UI is bundled in the APK (webDir). The backend URL is NOT baked in: the user enters it in the app.
const config: CapacitorConfig = {
  appId: 'com.phantomguard.app',
  appName: 'PHANTOMGUARD',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: { SplashScreen: { backgroundColor: '#000000', launchAutoHide: true, launchShowDuration: 0 } },
};
export default config;
