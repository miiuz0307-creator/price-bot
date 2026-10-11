// Build-time settings on top of app.json.
//  - EXPO_PUBLIC_API_URL: server address ("" = same origin, used for the web preview).
//  - GOOGLE_SERVICES_FILE: path to google-services.json (Firebase) to enable push on Android.
//  - APP_VERSION_CODE: Android versionCode (CI sets the run number so every APK upgrades the previous one).
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.APP_VERSION_CODE ? { versionCode: Number(process.env.APP_VERSION_CODE) } : {}),
    ...(process.env.GOOGLE_SERVICES_FILE ? { googleServicesFile: process.env.GOOGLE_SERVICES_FILE } : {}),
  },
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PUBLIC_API_URL !== undefined ? { apiUrl: process.env.EXPO_PUBLIC_API_URL } : {}),
    pushEnabled: Boolean(process.env.GOOGLE_SERVICES_FILE),
  },
});
