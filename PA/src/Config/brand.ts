/**
 * Who the bot speaks for. Stored in BotSettings.brand (editable from the
 * control apps); env vars only seed the first boot. Nothing company-specific
 * is hard-coded in prompts or replies.
 */
export type BrandProfile = {
  /** Company name used in replies and prompts, e.g. "Acme Software". */
  companyName: string;
  /** Same name written for Malayalam replies / speech (optional). */
  companyNameMl: string;
  /** What the business does — one line used to brief the AI. */
  businessDescription: string;
  /** Short list of offerings used in the first greeting. */
  servicesSummary: string;
  /** Optional full overrides. Use {company} and {services} placeholders. */
  greetingEn: string;
  greetingMl: string;
  leadThanksEn: string;
  leadThanksMl: string;
  /** Extra words that count as @mentioning the bot in groups (lowercase). */
  mentionAliases: string[];
};

export function defaultBrand(): BrandProfile {
  const name = process.env.PA_COMPANY_NAME?.trim() || 'our company';
  return {
    companyName: name,
    companyNameMl: process.env.PA_COMPANY_NAME_ML?.trim() || '',
    businessDescription: process.env.PA_BUSINESS_DESCRIPTION?.trim() || 'a business that helps customers with their projects',
    servicesSummary: process.env.PA_SERVICES_SUMMARY?.trim() || '',
    greetingEn: '',
    greetingMl: '',
    leadThanksEn: '',
    leadThanksMl: '',
    mentionAliases: (process.env.PA_MENTION_ALIASES ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  };
}

let current: BrandProfile = defaultBrand();

/** Sync accessor for prompt builders; kept fresh by botSettings. */
export function brand(): BrandProfile {
  return current;
}

export function setBrandCache(b: Partial<BrandProfile> | undefined): void {
  current = { ...defaultBrand(), ...(b ?? {}) } as BrandProfile;
  if (!Array.isArray(current.mentionAliases)) current.mentionAliases = [];
}

/** Name to use for the current reply language. */
export function brandName(lang: 'ml' | 'en' = 'en'): string {
  const b = brand();
  return lang === 'ml' && b.companyNameMl ? b.companyNameMl : b.companyName;
}

export function fillBrand(template: string, lang: 'ml' | 'en' = 'en'): string {
  return template.replace(/\{company\}/g, brandName(lang)).replace(/\{services\}/g, brand().servicesSummary);
}

export function normalizeBrandPatch(input: unknown): Partial<BrandProfile> {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: Partial<BrandProfile> = {};
  const str = (k: keyof BrandProfile, max: number) => {
    if (typeof src[k] === 'string') (out as Record<string, unknown>)[k] = (src[k] as string).trim().slice(0, max);
  };
  str('companyName', 120);
  str('companyNameMl', 120);
  str('businessDescription', 600);
  str('servicesSummary', 300);
  str('greetingEn', 600);
  str('greetingMl', 600);
  str('leadThanksEn', 600);
  str('leadThanksMl', 600);
  if (Array.isArray(src.mentionAliases)) {
    out.mentionAliases = src.mentionAliases.map((s) => String(s).trim().toLowerCase()).filter(Boolean).slice(0, 20);
  }
  return out;
}
