/**
 * Build-time app identity and endpoints come from the environment so the same
 * code can ship for any company. Set these in .env (see .env.example) or in EAS
 * build secrets. Keep APP_PACKAGE stable once published, or existing installs
 * can't update.
 */
module.exports = ({ config }) => {
  const env = process.env
  const pkg = env.APP_PACKAGE || config.android?.package
  const easProjectId = env.EAS_PROJECT_ID || config.extra?.eas?.projectId
  return {
    ...config,
    name: env.APP_NAME || config.name,
    ios: { ...config.ios, bundleIdentifier: env.APP_BUNDLE_ID || pkg || config.ios?.bundleIdentifier },
    android: {
      ...config.android,
      package: pkg,
      // Firebase config is required for push notifications on Android.
      ...(env.GOOGLE_SERVICES_FILE ? { googleServicesFile: env.GOOGLE_SERVICES_FILE } : {}),
    },
    extra: {
      ...config.extra,
      brandName: env.APP_BRAND_NAME || env.APP_NAME || config.name,
      paApiUrl: env.EXPO_PUBLIC_PA_API_URL || config.extra?.paApiUrl || '',
      atriumUrl: env.EXPO_PUBLIC_ATRIUM_URL || config.extra?.atriumUrl || '',
      eas: easProjectId ? { projectId: easProjectId } : {},
    },
  }
}
