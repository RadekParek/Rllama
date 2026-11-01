import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android shell.
 *
 * The UI is the same bundle as desktop and web; the Capacitor native layer is
 * only needed for two things: talking to APIs without browser CORS and keeping
 * keys in the app's private storage.
 *
 * CapacitorHttp routes `fetch` through the native HTTP stack, so provider
 * requests are not subject to browser CORS rules on Android.
 */
const config: CapacitorConfig = {
  appId: 'app.rllama',
  appName: 'Rllama',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
    backgroundColor: '#0b0b0d',
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
