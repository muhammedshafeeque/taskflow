/** User-facing product brand. Internal IDs may still use `taskflow` for compatibility. */
export const APP_NAME = 'Atrium';
export const APP_MARK = 'AT';
export const APP_TAGLINE = 'Projects · CRM · HRMS · Billing · Assets · Service';

/** Public brand asset paths (see `public/brand/`). */
export const APP_BRAND = {
  mark: '/brand/atrium-mark.png',
  markSvg: '/brand/atrium-mark.svg',
  icon: '/brand/atrium-app-icon.png',
  lockup: '/brand/atrium-lockup.png',
  wordmark: '/brand/atrium-wordmark.png',
  favicon: '/favicon.svg',
} as const;
