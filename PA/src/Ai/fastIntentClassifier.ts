import { getGroq } from '../Config/groq';
import {
  fastChatModel,
  reasoningParams,
  type AgentCallLog,
  pushAgentCall,
} from './models';
import {
  analyzeMessage,
  type AnalyzeContext,
  type AnalyzeResult,
  type MessageType,
} from '../MessageAnalyzer';
import { extractJsonObject } from '../Support/types';

const VALID: MessageType[] = [
  'greeting',
  'project_lead',
  'requirement',
  'support',
  'random',
];

/**
 * Fast LLM intent classifier for uncertain DMs (rules returned `random`).
 */
export async function classifyDmIntentFast(
  text: string,
  ctx: AnalyzeContext = {},
  agentCalls?: AgentCallLog[]
): Promise<AnalyzeResult> {
  const rules = analyzeMessage(text, ctx);
  if (rules.type !== 'random' || rules.reason === 'spam' || rules.reason === 'empty') {
    return rules;
  }

  const log = agentCalls || [];
  try {
    const model = fastChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      ...reasoningParams(model),
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: 'system',
          content: `Classify a WhatsApp DM for a software agency help desk.
Reply ONLY JSON: {"type":"greeting|project_lead|requirement|support|random","reason":"","shouldReply":true}
- greeting: hellos
- project_lead: new project / quote interest
- requirement: features/scope discussion
- support: bugs, status, existing project help
- random: off-topic — shouldReply false
Prefer support/requirement over random when ambiguous business text.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: text.slice(0, 800),
            lastType: ctx.lastType || null,
            hasHistory: Boolean(ctx.hasHistory),
          }),
        },
      ],
    });
    pushAgentCall(log, {
      agent: 'DM_INTENT',
      tier: 'fast',
      model,
    });
    const parsed = extractJsonObject(
      completion.choices[0]?.message?.content || ''
    ) as {
      type?: string;
      reason?: string;
      shouldReply?: boolean;
    } | null;
    if (parsed?.type && VALID.includes(parsed.type as MessageType)) {
      const type = parsed.type as MessageType;
      const shouldReply =
        typeof parsed.shouldReply === 'boolean'
          ? parsed.shouldReply
          : type !== 'random';
      return {
        type,
        shouldReply,
        reason: parsed.reason || 'fast_intent_classifier',
      };
    }
  } catch (err) {
    console.warn('FastIntentClassifier failed', err);
    pushAgentCall(log, {
      agent: 'DM_INTENT',
      tier: 'fast',
      skipped: true,
      reason: 'llm_failed',
    });
  }

  // Classifier unavailable: a help desk should answer, not silently drop.
  if (rules.reason === 'no_business_keywords' && text.trim().length >= 4) {
    return { type: 'support', shouldReply: true, reason: 'classifier_unavailable' };
  }
  return rules;
}
