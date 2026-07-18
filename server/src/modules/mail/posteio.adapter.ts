export interface PosteDefaults {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export function getPosteDefaults(): PosteDefaults {
  return {
    imapHost: process.env.POSTE_IMAP_HOST ?? 'localhost',
    imapPort: parseInt(process.env.POSTE_IMAP_PORT ?? '993', 10),
    smtpHost: process.env.POSTE_SMTP_HOST ?? 'localhost',
    smtpPort: parseInt(process.env.POSTE_SMTP_PORT ?? '587', 10),
  };
}

export function resolveMailboxHosts(input: {
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}): PosteDefaults {
  const defaults = getPosteDefaults();
  return {
    imapHost: input.imapHost ?? defaults.imapHost,
    imapPort: input.imapPort ?? defaults.imapPort,
    smtpHost: input.smtpHost ?? defaults.smtpHost,
    smtpPort: input.smtpPort ?? defaults.smtpPort,
  };
}

export const mailSyncIntervalMs = parseInt(process.env.MAIL_SYNC_INTERVAL_MS ?? '60000', 10);
