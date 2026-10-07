import { getGroq } from '../Config/groq';
import type { ConversationDoc } from '../Models/Conversation';
import { brand, brandName } from '../Config/brand';

const DEFAULT_CHAT_MODEL = 'qwen/qwen3.8-27b';

const SERVICE_ALLOW = [
  'custom_dev',
  'staff_aug',
  'cloud',
  'support_amc',
  'product',
  'consulting',
  'integration',
  'other',
] as const;

export type LeadAssessment = {
  ready: boolean;
  title: string;
  summary: string;
  companyName?: string;
  serviceInterest?: string[];
  industry?: string;
};

export type LeadUpdateAssessment = {
  hasUsefulUpdate: boolean;
  title?: string;
  summary: string;
  companyName?: string;
  serviceInterest?: string[];
  industry?: string;
};

function extractJson(raw: string): string | null {
  let text = raw.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : null;
}

function filterServices(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v
    .map(String)
    .filter((s) => (SERVICE_ALLOW as readonly string[]).includes(s));
}

/**
 * Decide if we have enough project detail to hand off to sales (create CRM lead).
 */
export async function assessLeadReady(
  conv: ConversationDoc | null,
  latestUserText: string
): Promise<LeadAssessment> {
  const history = (conv?.messages ?? []).slice(-12);
  const transcript = [
    ...history.map((m) => `${m.role}: ${m.content}`),
    `user: ${latestUserText}`,
  ].join('\n');

  const model =
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;

  const fallback: LeadAssessment = {
    ready: false,
    title: 'WhatsApp project enquiry',
    summary: latestUserText.slice(0, 400),
  };

  try {
    const completion = await getGroq().chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 350,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You qualify WhatsApp project leads for ${brandName()} (${brand().businessDescription}).
Return JSON only:
{
  "ready": boolean,
  "title": "short lead title",
  "summary": "1-3 sentence project brief for sales",
  "companyName": "optional",
  "industry": "optional",
  "serviceInterest": ["custom_dev"|"product"|"other"]
}

Set ready=true ONLY when the chat clearly has:
1) project type (mobile app / website / software), AND
2) business or use-case (what they sell/do), AND
3) at least one more concrete detail (features, users/access, WhatsApp sharing, billing modules, shop count, etc.)

If still missing core details, ready=false.`,
        },
        { role: 'user', content: transcript.slice(-4000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const json = extractJson(raw);
    if (!json) return fallback;
    const parsed = JSON.parse(json) as Partial<LeadAssessment>;
    return {
      ready: Boolean(parsed.ready),
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 160)
          : fallback.title,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 2000)
          : fallback.summary,
      companyName:
        typeof parsed.companyName === 'string'
          ? parsed.companyName.trim()
          : undefined,
      industry:
        typeof parsed.industry === 'string' ? parsed.industry.trim() : undefined,
      serviceInterest: filterServices(parsed.serviceInterest) ?? ['custom_dev'],
    };
  } catch (err) {
    console.error('assessLeadReady failed:', err);
    return fallback;
  }
}

/**
 * After a CRM lead exists, detect whether the latest user message adds useful project detail.
 */
export async function assessLeadUpdate(
  conv: ConversationDoc | null,
  latestUserText: string,
  currentSummary?: string
): Promise<LeadUpdateAssessment> {
  const history = (conv?.messages ?? []).slice(-10);
  const transcript = [
    ...history.map((m) => `${m.role}: ${m.content}`),
    `user: ${latestUserText}`,
  ].join('\n');

  const model =
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;

  const fallback: LeadUpdateAssessment = {
    hasUsefulUpdate: false,
    summary: currentSummary || latestUserText.slice(0, 400),
  };

  try {
    const completion = await getGroq().chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 350,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You maintain an existing ${brandName()} CRM lead from WhatsApp chat.
Current lead summary:
${(currentSummary || 'none').slice(0, 800)}

Return JSON only:
{
  "hasUsefulUpdate": boolean,
  "title": "optional improved short title",
  "summary": "full updated 1-4 sentence project brief for sales (merge old + new)",
  "companyName": "optional",
  "industry": "optional",
  "serviceInterest": ["custom_dev"|"product"|"other"]
}

Set hasUsefulUpdate=true ONLY if the latest user message adds concrete project detail
(features, users, platform, budget hint, timeline, business context, access rules, etc.)
that is not already clearly covered in the current summary.
Greetings, thanks, or vague acknowledgements → hasUsefulUpdate=false.`,
        },
        { role: 'user', content: transcript.slice(-4000) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const json = extractJson(raw);
    if (!json) return fallback;
    const parsed = JSON.parse(json) as Partial<LeadUpdateAssessment>;
    return {
      hasUsefulUpdate: Boolean(parsed.hasUsefulUpdate),
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 160)
          : undefined,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 2000)
          : fallback.summary,
      companyName:
        typeof parsed.companyName === 'string'
          ? parsed.companyName.trim()
          : undefined,
      industry:
        typeof parsed.industry === 'string' ? parsed.industry.trim() : undefined,
      serviceInterest: filterServices(parsed.serviceInterest),
    };
  } catch (err) {
    console.error('assessLeadUpdate failed:', err);
    return fallback;
  }
}
