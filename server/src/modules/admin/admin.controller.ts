import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { ApiError } from '../../utils/ApiError';
import { User } from '../auth/user.model';
import { env } from '../../config/env';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

export interface LicenseData {
  userCount: number;
  maxUsers: number | null;
  plan?: string;
}

export interface IntegrationConfigItem {
  id: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  envKeys: string[];
  missingKeys: string[];
  notes?: string;
}

function hasEnv(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function isEnvKeySatisfied(key: string): boolean {
  if (key.includes(' or ')) {
    return key.split(' or ').some((k) => hasEnv(k.trim()));
  }
  return hasEnv(key);
}

function makeIntegration(
  id: string,
  label: string,
  enabled: boolean,
  envKeys: string[],
  notes?: string
): IntegrationConfigItem {
  const missingKeys = envKeys.filter((k) => !isEnvKeySatisfied(k));
  return {
    id,
    label,
    enabled,
    configured: missingKeys.length === 0,
    envKeys,
    missingKeys,
    notes,
  };
}

export async function getLicense(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Unauthorized');
  if (
    req.user.role !== 'admin' &&
    !userHasPermission(req.user.permissions ?? [], TASK_FLOW_PERMISSIONS.TASKFLOW.LICENSE.VIEW)
  ) {
    throw new ApiError(403, 'Access denied');
  }

  const userCount = await User.countDocuments();
  res.status(200).json({
    success: true,
    data: {
      userCount,
      maxUsers: env.maxUsers,
      plan: env.maxUsers ? 'licensed' : undefined,
    } satisfies LicenseData,
  });
}

export async function getIntegrationsConfig(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, 'Unauthorized');
  if (
    req.user.role !== 'admin' &&
    !userHasPermission(req.user.permissions ?? [], TASK_FLOW_PERMISSIONS.TASKFLOW.LICENSE.VIEW)
  ) {
    throw new ApiError(403, 'Access denied');
  }

  const items: IntegrationConfigItem[] = [
    makeIntegration(
      'smtp',
      'SMTP mail',
      env.isSmtpEnabled,
      ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'],
      'Required for outbound mail and invite notifications.'
    ),
    makeIntegration(
      'azure-graph-mail',
      'Azure Graph API (Email)',
      env.isAzureGraphEnabled,
      ['AZURE_GRAPH_TENANT_ID', 'AZURE_GRAPH_CLIENT_ID', 'AZURE_GRAPH_CLIENT_SECRET', 'AZURE_GRAPH_FROM_EMAIL'],
      'Microsoft Graph app credentials for sending email.'
    ),
    makeIntegration(
      'sendgrid-mail',
      'SendGrid (Email)',
      env.isSendgridEnabled,
      ['SENDGRID_API_KEY', 'SENDGRID_FROM_EMAIL'],
      'SendGrid API based email delivery.'
    ),
    makeIntegration(
      'bytemail',
      'ByteMail (Email)',
      env.isBytemailEnabled,
      ['BYTEMAIL_API_KEY', 'BYTEMAIL_API_URL (optional)', 'BYTEMAIL_FROM_EMAIL (optional)'],
      'ByteMail HTTP API (X-API-Key) for outbound mail — alternative to SMTP/Graph/SendGrid.'
    ),
    makeIntegration(
      'firebase-push',
      'Firebase push notification',
      env.isFirebasePushEnabled,
      ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'],
      'Firebase FCM service account credentials for push notifications.'
    ),
    makeIntegration(
      'telegram',
      'Telegram',
      env.isTelegramEnabled,
      ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
      'Bot token + target chat required for alert pushes.'
    ),
    makeIntegration(
      'teams',
      'Microsoft Teams',
      env.isTeamsEnabled,
      ['TEAMS_WEBHOOK_URL'],
      'Incoming webhook URL from Teams connector.'
    ),
    makeIntegration(
      'teams-graph',
      'Azure Graph API (Teams)',
      env.isTeamsGraphEnabled,
      [
        'TEAMS_GRAPH_TENANT_ID',
        'TEAMS_GRAPH_CLIENT_ID',
        'TEAMS_GRAPH_CLIENT_SECRET',
        'TEAMS_GRAPH_TEAM_ID',
        'TEAMS_GRAPH_CHANNEL_ID',
      ],
      'Microsoft Graph client credentials + team/channel IDs for Teams channel notifications.'
    ),
    makeIntegration(
      'slack',
      'Slack',
      env.isSlackEnabled,
      ['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'SLACK_DEFAULT_CHANNEL'],
      'Bot token, signing secret, and default channel.'
    ),
    makeIntegration(
      'discord',
      'Discord notification',
      env.isDiscordEnabled,
      ['DISCORD_WEBHOOK_URL'],
      'Discord webhook URL for channel notifications.'
    ),
    makeIntegration(
      'whatsapp',
      'WhatsApp',
      env.isWhatsappEnabled,
      ['WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_DEFAULT_TO'],
      'WhatsApp Cloud API credentials and default recipient.'
    ),
    makeIntegration(
      'amazon-s3',
      'Amazon S3',
      env.isS3Enabled,
      ['S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
      'S3 bucket/object storage configuration for file uploads.'
    ),
    makeIntegration(
      'azure-blob',
      'Azure Blob Storage',
      env.isAzureBlobEnabled,
      ['AZURE_BLOB_CONTAINER', 'AZURE_BLOB_CONNECTION_STRING or AZURE_BLOB_ACCOUNT_NAME or AZURE_BLOB_ACCOUNT_KEY'],
      'Azure Blob storage configuration for file uploads.'
    ),
    makeIntegration(
      'twilio-sms',
      'Twilio (SMS)',
      env.isSmsEnabled && env.smsProvider === 'twilio',
      ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
      'Set IS_SMS_ENABLED=true and SMS_PROVIDER=twilio to send SMS via Twilio.'
    ),
    makeIntegration(
      'fast2sms',
      'Fast2SMS',
      env.isSmsEnabled && env.smsProvider === 'fast2sms',
      ['FAST2SMS_API_KEY'],
      'Set IS_SMS_ENABLED=true and SMS_PROVIDER=fast2sms.'
    ),
    makeIntegration(
      'whatstosms',
      'WhatsToSMS',
      env.isSmsEnabled && env.smsProvider === 'whatstosms',
      ['WHATSTOSMS_API_KEY', 'WHATSTOSMS_SENDER_ID'],
      'Set IS_SMS_ENABLED=true and SMS_PROVIDER=whatstosms.'
    ),
    makeIntegration(
      'jira',
      'Jira',
      env.isJiraEnabled,
      ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY'],
      'Atlassian API token credentials + default project key.'
    ),
    makeIntegration(
      'azure-devops',
      'Azure DevOps',
      env.isAzureDevopsEnabled,
      ['AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_ORG', 'AZURE_DEVOPS_PAT', 'AZURE_DEVOPS_PROJECT'],
      'Organization URL, PAT, and project for sync/import.'
    ),
    makeIntegration(
      'google-auth',
      'Google auth',
      hasEnv('GOOGLE_CLIENT_ID') || hasEnv('GOOGLE_CLIENT_SECRET'),
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      'OAuth login credentials for Google SSO.'
    ),
    makeIntegration(
      'microsoft-auth',
      'Microsoft auth',
      hasEnv('AZURE_AD_CLIENT_ID') || hasEnv('AZURE_AD_CLIENT_SECRET'),
      ['AZURE_AD_CLIENT_ID', 'AZURE_AD_CLIENT_SECRET', 'AZURE_AD_TENANT_ID', 'MICROSOFT_CALLBACK_URL'],
      'OAuth login credentials for Microsoft SSO.'
    ),
    makeIntegration(
      'github',
      'GitHub',
      env.isGithubEnabled,
      ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_WEBHOOK_SECRET'],
      'OAuth app + webhook secret for GitHub integration.'
    ),
    makeIntegration(
      'openai-models',
      'OpenAI models',
      env.isOpenaiEnabled,
      ['OPENAI_API_KEY', 'OPENAI_MODEL'],
      'AI model provider configuration for OpenAI.'
    ),
    makeIntegration(
      'claude-models',
      'Claude models',
      env.isClaudeEnabled,
      ['CLAUDE_API_KEY', 'CLAUDE_MODEL'],
      'AI model provider configuration for Claude.'
    ),
    makeIntegration(
      'groq-models',
      'Groq models',
      env.isGroqEnabled,
      ['GROQ_API_KEY', 'GROQ_MODEL'],
      'AI model provider configuration for Groq.'
    ),
    makeIntegration(
      'mistral-models',
      'Mistral AI models',
      env.isMistralEnabled,
      ['MISTRAL_API_KEY', 'MISTRAL_MODEL'],
      'AI model provider configuration for Mistral AI.'
    ),
  ];

  res.status(200).json({
    success: true,
    data: {
      items,
      sampleEnvKeys: [
        'IS_SMTP_ENABLED',
        'IS_AZURE_GRAPH_ENABLED',
        'IS_SENDGRID_ENABLED',
        'IS_BYTEMAIL_ENABLED',
        'IS_FIREBASE_PUSH_ENABLED',
        'IS_SLACK_ENABLED',
        'IS_TEAMS_ENABLED',
        'IS_TEAMS_GRAPH_ENABLED',
        'IS_TELEGRAM_ENABLED',
        'IS_DISCORD_ENABLED',
        'IS_WHATSAPP_ENABLED',
        'IS_S3_ENABLED',
        'IS_AZURE_BLOB_ENABLED',
        'IS_SMS_ENABLED',
        'IS_JIRA_ENABLED',
        'IS_AZURE_DEVOPS_ENABLED',
        'IS_GITHUB_ENABLED',
        'IS_OPENAI_ENABLED',
        'IS_CLAUDE_ENABLED',
        'IS_GROQ_ENABLED',
        'IS_MISTRAL_ENABLED',
      ],
    },
  });
}
