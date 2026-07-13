import dotenv from 'dotenv';

dotenv.config();

function cleanEnvValue(v: unknown): string {
  if (typeof v !== 'string') return '';
  // Handle values accidentally stored like: " 'https://..'; "
  return v.trim().replace(/^['"]/, '').replace(/['"];?$/, '').trim();
}

function bool(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'true';
}

export const env = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/pm-tool',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  integrationEncryptionKey: cleanEnvValue(process.env.INTEGRATION_ENCRYPTION_KEY),
  appUrl: process.env.APP_URL ?? 'http://localhost:5174',
  isPublicSignupEnabled: bool(process.env.IS_PUBLIC_SIGNUP_ENABLED),
  isEmailPasswordAuthEnabled: bool(process.env.IS_EMAIL_PASSWORD_AUTH_ENABLED),
  smtpHost: process.env.SMTP_HOST ?? process.env.EMAIL_HOST,
  smtpPort: (() => {
    const raw = process.env.SMTP_PORT ?? process.env.EMAIL_PORT;
    return raw ? parseInt(String(raw), 10) : undefined;
  })(),
  smtpUser: process.env.SMTP_USER ?? process.env.EMAIL_USER,
  smtpPass: process.env.SMTP_PASS ?? process.env.EMAIL_PASSWORD,
  mailFrom: process.env.MAIL_FROM ?? process.env.EMAIL_FROM ?? 'noreply@taskflow.local',
  isSmtpEnabled: bool(process.env.IS_SMTP_ENABLED),
  isSendgridEnabled: bool(process.env.IS_SENDGRID_ENABLED),
  sendgridApiKey: cleanEnvValue(process.env.SENDGRID_API_KEY),
  sendgridFromEmail: cleanEnvValue(process.env.SENDGRID_FROM_EMAIL),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  isFirebasePushEnabled: bool(process.env.IS_FIREBASE_PUSH_ENABLED),
  firebaseProjectId: cleanEnvValue(process.env.FIREBASE_PROJECT_ID),
  firebaseClientEmail: cleanEnvValue(process.env.FIREBASE_CLIENT_EMAIL),
  firebasePrivateKey: cleanEnvValue(process.env.FIREBASE_PRIVATE_KEY),
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
  isAzureGraphEnabled: bool(process.env.IS_AZURE_GRAPH_ENABLED),
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

  // Third-party integrations
  isTelegramEnabled: bool(process.env.IS_TELEGRAM_ENABLED),
  telegramBotToken: cleanEnvValue(process.env.TELEGRAM_BOT_TOKEN),
  telegramChatId: cleanEnvValue(process.env.TELEGRAM_CHAT_ID),

  isTeamsEnabled: bool(process.env.IS_TEAMS_ENABLED),
  teamsWebhookUrl: cleanEnvValue(process.env.TEAMS_WEBHOOK_URL),
  isTeamsGraphEnabled: bool(process.env.IS_TEAMS_GRAPH_ENABLED),
  teamsGraphTenantId: cleanEnvValue(process.env.TEAMS_GRAPH_TENANT_ID),
  teamsGraphClientId: cleanEnvValue(process.env.TEAMS_GRAPH_CLIENT_ID),
  teamsGraphClientSecret: cleanEnvValue(process.env.TEAMS_GRAPH_CLIENT_SECRET),
  teamsGraphTeamId: cleanEnvValue(process.env.TEAMS_GRAPH_TEAM_ID),
  teamsGraphChannelId: cleanEnvValue(process.env.TEAMS_GRAPH_CHANNEL_ID),

  isSlackEnabled: bool(process.env.IS_SLACK_ENABLED),
  slackBotToken: cleanEnvValue(process.env.SLACK_BOT_TOKEN),
  slackSigningSecret: cleanEnvValue(process.env.SLACK_SIGNING_SECRET),
  slackDefaultChannel: cleanEnvValue(process.env.SLACK_DEFAULT_CHANNEL),

  isDiscordEnabled: bool(process.env.IS_DISCORD_ENABLED),
  discordWebhookUrl: cleanEnvValue(process.env.DISCORD_WEBHOOK_URL),

  isWhatsappEnabled: bool(process.env.IS_WHATSAPP_ENABLED),
  whatsappAccessToken: cleanEnvValue(process.env.WHATSAPP_ACCESS_TOKEN),
  whatsappPhoneNumberId: cleanEnvValue(process.env.WHATSAPP_PHONE_NUMBER_ID),
  whatsappDefaultTo: cleanEnvValue(process.env.WHATSAPP_DEFAULT_TO),

  isS3Enabled: bool(process.env.IS_S3_ENABLED),
  s3Region: cleanEnvValue(process.env.S3_REGION),
  s3Bucket: cleanEnvValue(process.env.S3_BUCKET),
  s3AccessKeyId: cleanEnvValue(process.env.S3_ACCESS_KEY_ID),
  s3SecretAccessKey: cleanEnvValue(process.env.S3_SECRET_ACCESS_KEY),
  s3Endpoint: cleanEnvValue(process.env.S3_ENDPOINT),

  isAzureBlobEnabled: bool(process.env.IS_AZURE_BLOB_ENABLED),
  azureBlobConnectionString: cleanEnvValue(process.env.AZURE_BLOB_CONNECTION_STRING),
  azureBlobAccountName: cleanEnvValue(process.env.AZURE_BLOB_ACCOUNT_NAME),
  azureBlobAccountKey: cleanEnvValue(process.env.AZURE_BLOB_ACCOUNT_KEY),
  azureBlobContainer: cleanEnvValue(process.env.AZURE_BLOB_CONTAINER),

  isSmsEnabled: bool(process.env.IS_SMS_ENABLED),
  smsDefaultTo: cleanEnvValue(process.env.SMS_DEFAULT_TO),
  smsProvider: cleanEnvValue(process.env.SMS_PROVIDER).toLowerCase(),
  // Twilio
  twilioAccountSid: cleanEnvValue(process.env.TWILIO_ACCOUNT_SID),
  twilioAuthToken: cleanEnvValue(process.env.TWILIO_AUTH_TOKEN),
  twilioFromNumber: cleanEnvValue(process.env.TWILIO_FROM_NUMBER),
  // Fast2SMS
  fast2smsApiKey: cleanEnvValue(process.env.FAST2SMS_API_KEY),
  fast2smsRoute: cleanEnvValue(process.env.FAST2SMS_ROUTE) || 'q',
  // WhatsToSMS
  whatstosmsApiKey: cleanEnvValue(process.env.WHATSTOSMS_API_KEY),
  whatstosmsSenderId: cleanEnvValue(process.env.WHATSTOSMS_SENDER_ID),

  isJiraEnabled: bool(process.env.IS_JIRA_ENABLED),
  jiraBaseUrl: cleanEnvValue(process.env.JIRA_BASE_URL),
  jiraEmail: cleanEnvValue(process.env.JIRA_EMAIL),
  jiraApiToken: cleanEnvValue(process.env.JIRA_API_TOKEN),
  jiraProjectKey: cleanEnvValue(process.env.JIRA_PROJECT_KEY),

  isAzureDevopsEnabled: bool(process.env.IS_AZURE_DEVOPS_ENABLED),
  azureDevopsOrgUrl: cleanEnvValue(process.env.AZURE_DEVOPS_ORG_URL),
  azureDevopsOrg: cleanEnvValue(process.env.AZURE_DEVOPS_ORG),
  azureDevopsPat: cleanEnvValue(process.env.AZURE_DEVOPS_PAT),
  azureDevopsProject: cleanEnvValue(process.env.AZURE_DEVOPS_PROJECT),

  isGithubEnabled: bool(process.env.IS_GITHUB_ENABLED),
  githubClientId: cleanEnvValue(process.env.GITHUB_CLIENT_ID),
  githubClientSecret: cleanEnvValue(process.env.GITHUB_CLIENT_SECRET),
  githubWebhookSecret: cleanEnvValue(process.env.GITHUB_WEBHOOK_SECRET),

  // AI model providers
  isOpenaiEnabled: bool(process.env.IS_OPENAI_ENABLED),
  openaiApiKey: cleanEnvValue(process.env.OPENAI_API_KEY),
  openaiModel: cleanEnvValue(process.env.OPENAI_MODEL),
  isClaudeEnabled: bool(process.env.IS_CLAUDE_ENABLED),
  claudeApiKey: cleanEnvValue(process.env.CLAUDE_API_KEY),
  claudeModel: cleanEnvValue(process.env.CLAUDE_MODEL),
  isGroqEnabled: bool(process.env.IS_GROQ_ENABLED),
  groqApiKey: cleanEnvValue(process.env.GROQ_API_KEY),
  groqModel: cleanEnvValue(process.env.GROQ_MODEL),
  isMistralEnabled: bool(process.env.IS_MISTRAL_ENABLED),
  mistralApiKey: cleanEnvValue(process.env.MISTRAL_API_KEY),
  mistralModel: cleanEnvValue(process.env.MISTRAL_MODEL),
};

function assertRequiredWhenEnabled(enabled: boolean, integration: string, required: Array<[string, string | undefined]>) {
  if (!enabled) return;
  const missing = required.filter(([, value]) => !value || !String(value).trim()).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`[config] ${integration} enabled but missing env: ${missing.join(', ')}`);
  }
}

/**
 * Fail-fast checks to avoid runtime integration crashes from partial env setup.
 * Call once at startup.
 */
export function validateRuntimeConfig(): void {
  assertRequiredWhenEnabled(env.isSmtpEnabled, 'SMTP', [
    ['SMTP_HOST', env.smtpHost],
    ['SMTP_PORT', env.smtpPort ? String(env.smtpPort) : ''],
    ['SMTP_USER', env.smtpUser],
    ['SMTP_PASS', env.smtpPass],
    ['MAIL_FROM', env.mailFrom],
  ]);

  assertRequiredWhenEnabled(env.isAzureGraphEnabled, 'Azure Graph mail', [
    ['AZURE_GRAPH_TENANT_ID', env.azureGraphTenantId],
    ['AZURE_GRAPH_CLIENT_ID', env.azureGraphClientId],
    ['AZURE_GRAPH_CLIENT_SECRET', env.azureGraphClientSecret],
    ['AZURE_GRAPH_FROM_EMAIL', env.azureGraphFromEmail],
  ]);
  assertRequiredWhenEnabled(env.isSendgridEnabled, 'SendGrid mail', [
    ['SENDGRID_API_KEY', env.sendgridApiKey],
    ['SENDGRID_FROM_EMAIL', env.sendgridFromEmail],
  ]);
  assertRequiredWhenEnabled(env.isFirebasePushEnabled, 'Firebase push', [
    ['FIREBASE_PROJECT_ID', env.firebaseProjectId],
    ['FIREBASE_CLIENT_EMAIL', env.firebaseClientEmail],
    ['FIREBASE_PRIVATE_KEY', env.firebasePrivateKey],
  ]);

  assertRequiredWhenEnabled(env.isTelegramEnabled, 'Telegram', [
    ['TELEGRAM_BOT_TOKEN', env.telegramBotToken],
    ['TELEGRAM_CHAT_ID', env.telegramChatId],
  ]);

  assertRequiredWhenEnabled(env.isTeamsEnabled, 'Microsoft Teams', [
    ['TEAMS_WEBHOOK_URL', env.teamsWebhookUrl],
  ]);
  assertRequiredWhenEnabled(env.isTeamsGraphEnabled, 'Microsoft Teams (Azure Graph)', [
    ['TEAMS_GRAPH_TENANT_ID', env.teamsGraphTenantId],
    ['TEAMS_GRAPH_CLIENT_ID', env.teamsGraphClientId],
    ['TEAMS_GRAPH_CLIENT_SECRET', env.teamsGraphClientSecret],
    ['TEAMS_GRAPH_TEAM_ID', env.teamsGraphTeamId],
    ['TEAMS_GRAPH_CHANNEL_ID', env.teamsGraphChannelId],
  ]);

  assertRequiredWhenEnabled(env.isSlackEnabled, 'Slack', [
    ['SLACK_BOT_TOKEN', env.slackBotToken],
    ['SLACK_SIGNING_SECRET', env.slackSigningSecret],
    ['SLACK_DEFAULT_CHANNEL', env.slackDefaultChannel],
  ]);
  assertRequiredWhenEnabled(env.isDiscordEnabled, 'Discord', [
    ['DISCORD_WEBHOOK_URL', env.discordWebhookUrl],
  ]);
  assertRequiredWhenEnabled(env.isWhatsappEnabled, 'WhatsApp', [
    ['WHATSAPP_ACCESS_TOKEN', env.whatsappAccessToken],
    ['WHATSAPP_PHONE_NUMBER_ID', env.whatsappPhoneNumberId],
    ['WHATSAPP_DEFAULT_TO', env.whatsappDefaultTo],
  ]);
  assertRequiredWhenEnabled(env.isS3Enabled, 'Amazon S3', [
    ['S3_REGION', env.s3Region],
    ['S3_BUCKET', env.s3Bucket],
    ['S3_ACCESS_KEY_ID', env.s3AccessKeyId],
    ['S3_SECRET_ACCESS_KEY', env.s3SecretAccessKey],
  ]);
  assertRequiredWhenEnabled(env.isAzureBlobEnabled, 'Azure Blob Storage', [
    ['AZURE_BLOB_CONTAINER', env.azureBlobContainer],
    ['AZURE_BLOB_CONNECTION_STRING or (AZURE_BLOB_ACCOUNT_NAME + AZURE_BLOB_ACCOUNT_KEY)', env.azureBlobConnectionString || (env.azureBlobAccountName && env.azureBlobAccountKey ? 'ok' : '')],
  ]);
  assertRequiredWhenEnabled(env.isSmsEnabled, 'SMS', [
    ['SMS_PROVIDER', env.smsProvider],
  ]);
  if (env.isSmsEnabled && env.smsProvider === 'twilio') {
    assertRequiredWhenEnabled(true, 'Twilio SMS', [
      ['TWILIO_ACCOUNT_SID', env.twilioAccountSid],
      ['TWILIO_AUTH_TOKEN', env.twilioAuthToken],
      ['TWILIO_FROM_NUMBER', env.twilioFromNumber],
    ]);
  }
  if (env.isSmsEnabled && env.smsProvider === 'fast2sms') {
    assertRequiredWhenEnabled(true, 'Fast2SMS', [['FAST2SMS_API_KEY', env.fast2smsApiKey]]);
  }
  if (env.isSmsEnabled && env.smsProvider === 'whatstosms') {
    assertRequiredWhenEnabled(true, 'WhatsToSMS', [
      ['WHATSTOSMS_API_KEY', env.whatstosmsApiKey],
      ['WHATSTOSMS_SENDER_ID', env.whatstosmsSenderId],
    ]);
  }

  assertRequiredWhenEnabled(env.isJiraEnabled, 'Jira', [
    ['JIRA_BASE_URL', env.jiraBaseUrl],
    ['JIRA_EMAIL', env.jiraEmail],
    ['JIRA_API_TOKEN', env.jiraApiToken],
    ['JIRA_PROJECT_KEY', env.jiraProjectKey],
  ]);

  assertRequiredWhenEnabled(env.isAzureDevopsEnabled, 'Azure DevOps', [
    ['AZURE_DEVOPS_PAT', env.azureDevopsPat],
    ['AZURE_DEVOPS_PROJECT', env.azureDevopsProject],
    ['AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_ORG', env.azureDevopsOrgUrl || env.azureDevopsOrg],
  ]);

  assertRequiredWhenEnabled(env.isGithubEnabled, 'GitHub', [
    ['GITHUB_CLIENT_ID', env.githubClientId],
    ['GITHUB_CLIENT_SECRET', env.githubClientSecret],
    ['GITHUB_WEBHOOK_SECRET', env.githubWebhookSecret],
  ]);
  assertRequiredWhenEnabled(env.isOpenaiEnabled, 'OpenAI', [
    ['OPENAI_API_KEY', env.openaiApiKey],
    ['OPENAI_MODEL', env.openaiModel],
  ]);
  assertRequiredWhenEnabled(env.isClaudeEnabled, 'Claude', [
    ['CLAUDE_API_KEY', env.claudeApiKey],
    ['CLAUDE_MODEL', env.claudeModel],
  ]);
  assertRequiredWhenEnabled(env.isGroqEnabled, 'Groq', [
    ['GROQ_API_KEY', env.groqApiKey],
    ['GROQ_MODEL', env.groqModel],
  ]);
  assertRequiredWhenEnabled(env.isMistralEnabled, 'Mistral AI', [
    ['MISTRAL_API_KEY', env.mistralApiKey],
    ['MISTRAL_MODEL', env.mistralModel],
  ]);

  // OAuth should be all-or-nothing to prevent auth route bugs.
  if ((env.googleClientId && !env.googleClientSecret) || (!env.googleClientId && env.googleClientSecret)) {
    throw new Error('[config] Google OAuth must set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET');
  }
  if ((env.azureAdClientId && !env.azureAdClientSecret) || (!env.azureAdClientId && env.azureAdClientSecret)) {
    throw new Error('[config] Microsoft OAuth must set both AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET');
  }
}
