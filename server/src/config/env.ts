import dotenv from 'dotenv';

dotenv.config();

function cleanEnvValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  // Handle values accidentally stored like: " 'https://..'; "
  return v.trim().replace(/^['"]/, '').replace(/['"];?$/, '').trim();
}

export const env = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/pm-tool',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  appUrl: process.env.APP_URL ?? 'http://localhost:5174',
  smtpHost: process.env.SMTP_HOST ?? process.env.EMAIL_HOST,
  smtpPort: (() => {
    const raw = process.env.SMTP_PORT ?? process.env.EMAIL_PORT;
    return raw ? parseInt(String(raw), 10) : undefined;
  })(),
  smtpUser: process.env.SMTP_USER ?? process.env.EMAIL_USER,
  smtpPass: process.env.SMTP_PASS ?? process.env.EMAIL_PASSWORD,
  mailFrom: process.env.MAIL_FROM ?? process.env.EMAIL_FROM ?? 'noreply@taskflow.local',
  isSmtpEnabled: process.env.IS_SMTP_ENABLED === 'true',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  /** Max users allowed (null = no limit). Set MAX_USERS in env to enforce. */
  maxUsers: (() => {
    const v = process.env.MAX_USERS;
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })(),

  azureAdClientId: cleanEnvValue(process.env.AZURE_AD_CLIENT_ID),
  azureAdClientSecret: cleanEnvValue(process.env.AZURE_AD_CLIENT_SECRET),
  azureAdTenantId: cleanEnvValue(process.env.AZURE_AD_TENANT_ID) || 'common',
  azureRedirectUri: cleanEnvValue(process.env.AZURE_REDIRECT_URI) || cleanEnvValue(process.env.APP_URL) || 'http://localhost:5173/login',
  isAzureGraphEnabled: process.env.IS_AZURE_GRAPH_ENABLED === 'true',
  azureGraphFromEmail: cleanEnvValue(process.env.AZURE_GRAPH_FROM_EMAIL),
  azureGraphTenantId: cleanEnvValue(process.env.AZURE_GRAPH_TENANT_ID),
  azureGraphClientId: cleanEnvValue(process.env.AZURE_GRAPH_CLIENT_ID),
  azureGraphClientSecret: cleanEnvValue(process.env.AZURE_GRAPH_CLIENT_SECRET),
  azureGraphTokenEndpoint: (() => {
    const tenant = cleanEnvValue(process.env.AZURE_GRAPH_TENANT_ID);
    if (!tenant) return '';
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  })(),

  msUserInfoEndpoint: cleanEnvValue(process.env.MS_USER_INFO_ENDPOINT) || 'https://graph.microsoft.com/oidc/userinfo',
  frontendUrl: cleanEnvValue(process.env.FRONTEND_URL) || cleanEnvValue(process.env.APP_URL) || 'http://localhost:5173',

  googleClientId: cleanEnvValue(process.env.GOOGLE_CLIENT_ID),
  googleClientSecret: cleanEnvValue(process.env.GOOGLE_CLIENT_SECRET),
  googleCallbackUrl:
    cleanEnvValue(process.env.GOOGLE_CALLBACK_URL) || `http://localhost:${parseInt(process.env.PORT ?? '5000', 10)}/api/auth/oauth/google/callback`,

  microsoftOAuthCallbackUrl:
    cleanEnvValue(process.env.MICROSOFT_CALLBACK_URL) ||
    `http://localhost:${parseInt(process.env.PORT ?? '5000', 10)}/api/auth/oauth/microsoft/callback`,

  msTokenEndpoint: (() => {
    const tenant = cleanEnvValue(process.env.AZURE_AD_TENANT_ID) || 'common';
    const configured = cleanEnvValue(process.env.MS_TOKEN_ENDPOINT);
    const commonTokenEndpoint = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
    // Single-tenant apps must NOT use /common.
    if (tenant !== 'common') {
      if (!configured) return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
      return configured === commonTokenEndpoint || configured.includes('/common/oauth2/')
        ? `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
        : configured;
    }
    return configured || commonTokenEndpoint;
  })(),
};
