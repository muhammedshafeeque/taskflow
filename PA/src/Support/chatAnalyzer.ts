import { getGroq } from '../Config/groq';
import { analyzeMessage } from '../MessageAnalyzer';
import {
  ChatAnalysisSchema,
  extractJsonObject,
  supportChatModel,
  type ChatAnalysis,
  type SupportCategory,
} from './types';

const ISSUE_HINT =
  /\b(bug|crash|error|broken|not\s*working|fails?|issue|incorrect|wrong|stuck|unable|can't|cannot|login\s*fail)\b/i;
const FEATURE_HINT =
  /\b(feature|enhancement|would\s*be\s*nice|can\s*you\s*add|please\s*add)\b/i;
const CHANGE_HINT =
  /\b(change\s*request|instead\s*of|should\s*be|modify|update\s*the\s*behavior)\b/i;
const STATUS_HINT =
  /\b(status|update|progress|any\s*news|eta|when\s*will)\b/i;
const FOLLOW_HINT =
  /\b(still|again|follow\s*up|as\s*i\s*said|previously|earlier)\b/i;

function seedCategory(text: string): SupportCategory {
  const t = text.trim();
  if (!t) return 'OTHER';
  const rules = analyzeMessage(t);
  if (rules.type === 'greeting') return 'GENERAL_CONVERSATION';
  if (ISSUE_HINT.test(t)) return 'BUG_REPORT';
  if (FEATURE_HINT.test(t)) return 'FEATURE_REQUEST';
  if (CHANGE_HINT.test(t)) return 'CHANGE_REQUEST';
  if (STATUS_HINT.test(t)) return 'STATUS_REQUEST';
  if (FOLLOW_HINT.test(t)) return 'FOLLOW_UP';
  if (rules.type === 'support') return 'SUPPORT_REQUEST';
  if (/\?/.test(t)) return 'GENERAL_QUESTION';
  return 'GENERAL_CONVERSATION';
}

function seedAnalysis(
  text: string,
  opts: { isReply: boolean; hasHistory: boolean }
): ChatAnalysis {
  const category = seedCategory(text);
  const isIssue =
    category === 'BUG_REPORT' ||
    category === 'ISSUE_REPORT' ||
    category === 'COMPLAINT' ||
    (category === 'SUPPORT_REQUEST' && ISSUE_HINT.test(text));
  return ChatAnalysisSchema.parse({
    intent: category.toLowerCase(),
    category,
    sentiment: category === 'COMPLAINT' ? 'negative' : 'neutral',
    isSupportRequest:
      isIssue ||
      category === 'SUPPORT_REQUEST' ||
      category === 'STATUS_REQUEST',
    isIssue,
    isFollowUp: category === 'FOLLOW_UP' || (opts.hasHistory && FOLLOW_HINT.test(text)),
    isReply: opts.isReply,
    relatedMessageIds: [],
    confidence: 0.45,
    summary: text.slice(0, 160),
    entities: [],
    possibleIssue: isIssue ? text.slice(0, 200) : '',
  });
}

/**
 * Structured Chat Analyzer for project support groups.
 * Seeds with rules, then refines with LLM JSON when possible.
 */
export async function analyzeSupportMessage(
  text: string,
  opts: {
    isReply: boolean;
    hasHistory: boolean;
    recentContext?: string;
    projectLabels?: string[];
  }
): Promise<ChatAnalysis> {
  const seeded = seedAnalysis(text, opts);

  try {
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model: supportChatModel(),
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `You classify WhatsApp project-support messages. Reply with ONLY valid JSON:
{"intent":"","category":"GENERAL_QUESTION|SUPPORT_REQUEST|BUG_REPORT|ISSUE_REPORT|CHANGE_REQUEST|FEATURE_REQUEST|FOLLOW_UP|STATUS_REQUEST|COMPLAINT|GENERAL_CONVERSATION|OTHER","sentiment":"","isSupportRequest":false,"isIssue":false,"isFollowUp":false,"isReply":false,"relatedMessageIds":[],"confidence":0.0,"summary":"","entities":[],"possibleIssue":""}
Rules: greetings/small talk => GENERAL_CONVERSATION; how-to questions => GENERAL_QUESTION; crashes/errors => BUG_REPORT or ISSUE_REPORT; do not invent facts.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: text,
            isReply: opts.isReply,
            hasHistory: opts.hasHistory,
            projects: opts.projectLabels || [],
            recentContext: (opts.recentContext || '').slice(0, 1200),
            seed: seeded,
          }),
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);
    if (parsed) {
      const merged = ChatAnalysisSchema.parse({
        ...seeded,
        ...(parsed as object),
        isReply: opts.isReply || Boolean((parsed as ChatAnalysis).isReply),
      });
      return merged;
    }
  } catch (err) {
    console.warn('Chat analyzer LLM failed; using seed', err);
  }

  return seeded;
}

export function isSpamAnalysis(analysis: ChatAnalysis): boolean {
  return (
    analysis.category === 'OTHER' &&
    analysis.confidence >= 0.85 &&
    /spam|lottery|crypto/i.test(analysis.summary + analysis.intent)
  );
}

/** Pure helper for tests — rule seed only. */
export function seedSupportAnalysisForTests(
  text: string,
  opts: { isReply?: boolean; hasHistory?: boolean } = {}
): ChatAnalysis {
  return seedAnalysis(text, {
    isReply: Boolean(opts.isReply),
    hasHistory: Boolean(opts.hasHistory),
  });
}
