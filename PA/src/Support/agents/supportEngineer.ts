import { getGroq } from '../../Config/groq';
import {
  fastChatModel,
  strongChatModel,
  type AgentCallLog,
  pushAgentCall,
} from '../../Ai/models';
import type { AtriumProjectRef } from '../../Models/WhatsappGroup';
import type { ConversationContextBundle } from '../context/conversationContext';
import type { TaskflowProjectContext } from '../context/taskflowContext';
import {
  SupportEngineerDecisionSchema,
  extractJsonObject,
  type ChatAnalysis,
  type SupportEngineerDecision,
} from '../types';

const ESCALATE_CATEGORIES = new Set([
  'BUG_REPORT',
  'ISSUE_REPORT',
  'CHANGE_REQUEST',
  'FEATURE_REQUEST',
  'COMPLAINT',
]);

const REPRO_HINT =
  /\b(reproduce|steps?\s*to|error\s*code|stack\s*trace|crash|exception|screenshot|500|404|not\s*working|broken)\b/i;

function projectLabel(projects: AtriumProjectRef[]): string {
  return projects[0]?.name?.trim() || 'your project';
}

export async function runSupportEngineer(input: {
  message: string;
  analysis: ChatAnalysis;
  projects: AtriumProjectRef[];
  conversation: ConversationContextBundle;
  taskflow: TaskflowProjectContext;
  langHint?: 'ml' | 'en';
  agentCalls?: AgentCallLog[];
}): Promise<SupportEngineerDecision> {
  const agentCalls = input.agentCalls || [];
  const shouldEscalate =
    input.analysis.isIssue ||
    ESCALATE_CATEGORIES.has(input.analysis.category) ||
    Boolean(input.analysis.possibleIssue?.trim());

  const projectLine = input.projects
    .map((p) => `${p.name}${p.key ? ` [${p.key}]` : ''}`)
    .join(', ');

  const ticketLine = (input.taskflow.tickets || [])
    .slice(0, 8)
    .map(
      (t) =>
        `${t.key || t.issueKey || t.id}: ${t.subject} (${t.status}/${t.priority})`
    )
    .join('\n');

  try {
    const model = fastChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: 350,
      messages: [
        {
          role: 'system',
          content: `You are the Ivorix Support Engineer for WhatsApp project support groups.
Reply with ONLY JSON:
{"action":"REPLY"|"ESCALATE_QA","customerReply":"","escalateReason":"","state":"COMPLETED"|"ESCALATED_TO_QA"}

Rules:
- Be professional, polite, concise (max 2 short sentences for customerReply).
- Enterprise support tone: calm, clear, no slang, no emoji.
- Never invent ticket IDs, fixes, or internal QA details.
- GENERAL_CONVERSATION / greetings: warm short reply offering help for the linked project(s); action REPLY. Prefer "Hello" / professional Malayalam over casual "Hi".
- GENERAL_QUESTION / STATUS_REQUEST / SUPPORT_REQUEST without clear bug: answer from context if possible; else ask one clarifying question; action REPLY.
- Clear bugs/errors/crashes/feature or change requests: action ESCALATE_QA, customerReply can be brief acknowledgment OR empty (pipeline may fill after QA).
- Use conversation history; do not repeat the same question.
- Language: match the customer (${input.langHint === 'ml' ? 'Malayalam script preferred' : 'English'}).`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: input.message,
            analysis: input.analysis,
            projects: projectLine,
            conversation: input.conversation.recentText.slice(0, 2000),
            quoted: input.conversation.quotedText,
            openTickets: ticketLine,
            projectDetails: input.taskflow.projects,
            suggestEscalate: shouldEscalate,
          }),
        },
      ],
    });
    pushAgentCall(agentCalls, {
      agent: 'SUPPORT_ENGINEER',
      tier: 'fast',
      model,
    });
    const raw = completion.choices[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);
    if (parsed) {
      const decision = SupportEngineerDecisionSchema.parse(parsed);
      return softenEscalationOverride(decision, input);
    }
  } catch (err) {
    console.warn('Support Engineer LLM failed', err);
    pushAgentCall(agentCalls, {
      agent: 'SUPPORT_ENGINEER',
      tier: 'fast',
      skipped: true,
      reason: 'llm_failed',
    });
  }

  if (shouldEscalate) {
    return {
      action: 'ESCALATE_QA',
      customerReply: '',
      escalateReason: input.analysis.possibleIssue || input.analysis.summary,
      state: 'ESCALATED_TO_QA',
    };
  }

  const name = projectLabel(input.projects);
  return {
    action: 'REPLY',
    customerReply:
      input.langHint === 'ml'
        ? `ഹലോ, ഐവോറിക്സ് സപ്പോർട്ട് ടീമിൽ നിന്നാണ്. ${name} സംബന്ധിച്ച് എങ്ങനെ സഹായിക്കാം?`
        : `Hello — this is the Ivorix support team for ${name}. How may we assist you today?`,
    state: 'COMPLETED',
  };
}

/**
 * Do not force ESCALATE_QA from a weak seed when SE chose REPLY with a
 * usable answer and there is no reproduction signal.
 */
export function softenEscalationOverride(
  decision: SupportEngineerDecision,
  input: {
    message: string;
    analysis: ChatAnalysis;
  }
): SupportEngineerDecision {
  const shouldEscalateHint =
    input.analysis.isIssue ||
    ESCALATE_CATEGORIES.has(input.analysis.category) ||
    Boolean(input.analysis.possibleIssue?.trim());

  if (decision.action !== 'REPLY') return decision;

  // Empty reply + escalate hint → escalate
  if (shouldEscalateHint && !decision.customerReply.trim()) {
    return {
      ...decision,
      action: 'ESCALATE_QA',
      state: 'ESCALATED_TO_QA',
      escalateReason:
        decision.escalateReason ||
        input.analysis.possibleIssue ||
        input.analysis.summary,
    };
  }

  // Soft override only for strong bug signals with repro evidence
  const hasRepro = REPRO_HINT.test(input.message);
  if (
    shouldEscalateHint &&
    input.analysis.isIssue &&
    input.analysis.confidence >= 0.85 &&
    hasRepro &&
    ESCALATE_CATEGORIES.has(input.analysis.category)
  ) {
    return {
      action: 'ESCALATE_QA',
      customerReply: decision.customerReply,
      escalateReason:
        decision.escalateReason ||
        input.analysis.possibleIssue ||
        input.analysis.summary,
      state: 'ESCALATED_TO_QA',
    };
  }

  // Trust SE REPLY when it provided a customer answer (no blanket force)
  return decision;
}

export async function craftFinalCustomerReply(input: {
  message: string;
  analysis: ChatAnalysis;
  projects: AtriumProjectRef[];
  conversation: ConversationContextBundle;
  qaRecommendedResponse?: string;
  ticketId?: string;
  issueKey?: string;
  duplicate?: boolean;
  langHint?: 'ml' | 'en';
  agentCalls?: AgentCallLog[];
}): Promise<string> {
  const agentCalls = input.agentCalls || [];
  const looksLikeMongoId = (v?: string) =>
    Boolean(v && /^[a-f0-9]{24}$/i.test(v.trim()));
  const ref =
    (input.issueKey && !looksLikeMongoId(input.issueKey) && input.issueKey) ||
    (input.ticketId && !looksLikeMongoId(input.ticketId) && input.ticketId) ||
    undefined;
  const project = projectLabel(input.projects);

  if (ref && input.duplicate) {
    return input.langHint === 'ml'
      ? `നന്ദി, അധിക വിവരങ്ങൾ ലഭിച്ചു. ${project} സംബന്ധിച്ച ഈ വിഷയം എൽ‌റെഡി ടിക്കറ്റ് ${ref} ആയി ട്രാക്ക് ചെയ്യുന്നു; നിങ്ങളുടെ അപ്ഡേറ്റ് അതിലേക്ക് ചേർത്തിട്ടുണ്ട്. ഞങ്ങളുടെ ടീം തുടർന്ന് അന്വേഷിക്കും.`
      : `Thank you for the update. This matter on ${project} is already being tracked under ticket ${ref}, and we have added your latest details to that ticket. Our team will continue the investigation and follow up with you.`;
  }
  if (ref) {
    return input.langHint === 'ml'
      ? `നന്ദി, റിപ്പോർട്ട് ചെയ്തതിന്. ${project} സംബന്ധിച്ച വിഷയം ഞങ്ങൾ രജിസ്റ്റർ ചെയ്തു; ടിക്കറ്റ് ഐഡി ${ref}. ഞങ്ങളുടെ സപ്പോർട്ട് ടീം അന്വേഷിച്ച് പുരോഗതി അറിയിക്കും.`
      : `Thank you for reporting this. We have logged the issue with ${project} and opened ticket ${ref} for our support team to investigate. We will keep you informed of the progress.`;
  }
  if (input.duplicate) {
    return input.langHint === 'ml'
      ? `നന്ദി. ${project} സംബന്ധിച്ച ഈ വിഷയം നിലവിലുള്ള സപ്പോർട്ട് ടിക്കറ്റിൽ ട്രാക്ക് ചെയ്യുന്നു; നിങ്ങളുടെ പുതിയ വിവരങ്ങൾ ചേർത്തിട്ടുണ്ട്.`
      : `Thank you. This matter for ${project} is already tracked on an existing support ticket, and we have recorded your latest information for our team.`;
  }
  if (input.qaRecommendedResponse?.trim()) {
    try {
      const model = strongChatModel();
      const groq = getGroq();
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0.25,
        max_tokens: 260,
        messages: [
          {
            role: 'system',
            content: `You write professional WhatsApp replies for Ivorix customer support.
Rules:
- Polite, calm, and confident — enterprise support tone.
- Max 2 short sentences.
- Acknowledge the concern; give a clear next step or guidance.
- No slang, no emoji, no internal QA/system wording.
- Do not invent ticket IDs, timelines, or fixes.
- Output plain text only.
- Language: ${input.langHint === 'ml' ? 'Malayalam script' : 'clear professional English'}.`,
          },
          {
            role: 'user',
            content: JSON.stringify({
              customerMessage: input.message,
              guidance: input.qaRecommendedResponse,
              project,
              lang: input.langHint || 'en',
            }),
          },
        ],
      });
      pushAgentCall(agentCalls, {
        agent: 'CRAFT_REPLY',
        tier: 'strong',
        model,
      });
      const text = (completion.choices[0]?.message?.content || '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
      if (text.length >= 8) return text.slice(0, 500);
    } catch {
      // fall through
    }
    return input.qaRecommendedResponse.trim().slice(0, 500);
  }
  return '';
}
