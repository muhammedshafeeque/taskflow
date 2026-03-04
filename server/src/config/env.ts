import dotenv from 'dotenv';

dotenv.config();

export const env = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/pm-tool',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  appUrl: process.env.APP_URL ?? 'http://localhost:5173',
  smtpHost: process.env.SMTP_HOST ?? process.env.EMAIL_HOST,
  smtpPort: (() => {
    const raw = process.env.SMTP_PORT ?? process.env.EMAIL_PORT;
    return raw ? parseInt(String(raw), 10) : undefined;
  })(),
  smtpUser: process.env.SMTP_USER ?? process.env.EMAIL_USER,
  smtpPass: process.env.SMTP_PASS ?? process.env.EMAIL_PASSWORD,
  mailFrom: process.env.MAIL_FROM ?? process.env.EMAIL_FROM ?? 'noreply@taskflow.local',
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  /** Max users allowed (null = no limit). Set MAX_USERS in env to enforce. */
  maxUsers: (() => {
    const v = process.env.MAX_USERS;
    if (!v) return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })(),
};
