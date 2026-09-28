import { getGroq } from '../Config/groq';
import { fastChatModel, reasoningParams, type AgentCallLog, pushAgentCall } from '../Ai/models';
import { analyzeMessage } from '../MessageAnalyzer';
import {
  ChatAnalysisSchema,
  extractJsonObject,
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
const SPAM_HINT = /\b(spam|lottery|crypto|forex\s*signal|porn|xxx)\b/i;

const SKIP_LLM_CATEGORIES = new Set<SupportCategory>([
  'STATUS_REQUEST',
  'GENERAL_CONVERSATION',
  'OTHER',
]);

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

function seedConfidence(category: SupportCategory, text: string): number {
  const t = text.trim();
  if (category === 'GENERAL_CONVERSATION' && t.length < 40) return 0.9;
  if (category === 'STATUS_REQUEST' && STATUS_HINT.test(t)) return 0.88;
  if (category === 'OTHER' && SPAM_HINT.test(t)) return 0.9;
  if (category === 'BUG_REPORT' && ISSUE_HINT.test(t)) return 0.72;
  if (category === 'FEATURE_REQUEST' && FEATURE_HINT.test(t)) return 0.7;
  if (category === 'CHANGE_REQUEST' && CHANGE_HINT.test(t)) return 0.7;
  if (category === 'FOLLOW_UP') return 0.65;
  return 0.45;
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
    isFollowUp:
      category === 'FOLLOW_UP' || (opts.hasHistory && FOLLOW_HINT.test(text)),
    isReply: opts.isReply,
    relatedMessageIds: [],
    confidence: seedConfidence(category, text),
    summary: text.slice(0, 160),
    entities: [],
    possibleIssue: isIssue ? text.slice(0, 200) : '',
  });
}

/**
 * High-confidence rule seeds skip the Groq triage call (cost saver).
 */
export function shouldTrustSeedWithoutLlm(seeded: ChatAnalysis): boolean {
  if (seeded.confidence < 0.85) return false;
  if (!SKIP_LLM_CATEGORIES.has(seeded.category)) return false;
  if (seeded.category === 'OTHER') {
    return SPAM_HINT.test(seeded.summary + seeded.intent + seeded.possibleIssue);
  }
  return true;
}

export type AnalyzeSupportResult = {
  analysis: ChatAnalysis;
  agentCalls: AgentCallLog[];
};

/**
 * Structured Chat Analyzer (TriageAgent) for project support groups.
 * Seeds with rules; uses fast model only when seed is uncertain.
 */
export async function analyzeSupportMessage(
  text: string,
  opts: {
    isReply: boolean;
    hasHistory: boolean;
    recentContext?: string;
    projectLabels?: string[];
    agentCalls?: AgentCallLog[];
  }
): Promise<ChatAnalysis> {
  const agentCalls = opts.agentCalls || [];
  const seeded = seedAnalysis(text, opts);

  if (shouldTrustSeedWithoutLlm(seeded)) {
    pushAgentCall(agentCalls, {
      agent: 'CHAT_ANALYZER',
      tier: 'none',
      skipped: true,
      reason: 'high_conf_rule_seed',
    });
    return seeded;
  }

  try {
    const model = fastChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      ...reasoningParams(model),
      temperature: 0.1,
      max_tokens: 300,
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
    pushAgentCall(agentCalls, {
      agent: 'CHAT_ANALYZER',
      tier: 'fast',
      model,
    });
    const raw = completion.choices[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);
    if (parsed) {
      return ChatAnalysisSchema.parse({
        ...seeded,
        ...(parsed as object),
        isReply: opts.isReply || Boolean((parsed as ChatAnalysis).isReply),
      });
    }
  } catch (err) {
    console.warn('Chat analyzer LLM failed; using seed', err);
    pushAgentCall(agentCalls, {
      agent: 'CHAT_ANALYZER',
      tier: 'fast',
      skipped: true,
      reason: 'llm_failed_seed_fallback',
    });
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
