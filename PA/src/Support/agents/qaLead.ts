import { getGroq } from '../../Config/groq';
import {
  strongChatModel,
  type AgentCallLog,
  pushAgentCall,
} from '../../Ai/models';
import type { AtriumProjectRef } from '../../Models/WhatsappGroup';
import type { ConversationContextBundle } from '../context/conversationContext';
import type { TaskflowProjectContext } from '../context/taskflowContext';
import {
  QaDecisionSchema,
  extractJsonObject,
  type ChatAnalysis,
  type QaDecision,
} from '../types';

export async function runQaLead(input: {
  message: string;
  analysis: ChatAnalysis;
  escalateReason?: string;
  projects: AtriumProjectRef[];
  conversation: ConversationContextBundle;
  taskflow: TaskflowProjectContext;
  agentCalls?: AgentCallLog[];
}): Promise<QaDecision> {
  const agentCalls = input.agentCalls || [];
  const tickets = (input.taskflow.tickets || []).slice(0, 15);
  const primaryProjectId = input.projects[0]?.id;

  try {
    const model = strongChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: 700,
      messages: [
        {
          role: 'system',
          content: `You are the Ivorix QA Lead agent. Investigate WhatsApp support reports.
Reply with ONLY JSON matching:
{"isIssue":false,"classification":"BUG|CHANGE_REQUEST|FEATURE_REQUEST|CONFIGURATION_ISSUE|USER_ERROR|NOT_REPRODUCIBLE|NOT_AN_ISSUE","reason":"","recommendedResponse":"","isDuplicate":false,"duplicateTicketId":"","issue":{"title":"","type":"BUG","priority":"MEDIUM","severity":"MEDIUM","description":"","stepsToReproduce":[],"expectedBehavior":"","actualBehavior":"","affectedModule":"","projectId":""}}

Rules:
- Do not assume every complaint is a bug.
- If similar open ticket exists, set isDuplicate true and duplicateTicketId to that ticket's **key** field (e.g. "SDFSDF-6"), never the long Mongo id.
- If confirmed BUG/CHANGE_REQUEST/FEATURE_REQUEST: isIssue true and fill issue.
- Otherwise isIssue false with recommendedResponse for Support Engineer to tell the customer.
- Never invent ticket keys that are not in the openTickets list.
- Prefer tickets listed first — they are relevance-ranked.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: input.message,
            analysis: input.analysis,
            escalateReason: input.escalateReason,
            projects: input.projects,
            primaryProjectId,
            conversation: input.conversation.recentText.slice(0, 2000),
            openTickets: tickets.map((t) => ({
              key: t.key || t.issueKey || t.id,
              id: t.id,
              subject: t.subject,
              status: t.status,
              priority: t.priority,
            })),
            recentIssues: input.taskflow.recentIssues?.slice(0, 10),
            projectDetails: input.taskflow.projects,
          }),
        },
      ],
    });
    pushAgentCall(agentCalls, {
      agent: 'QA_LEAD',
      tier: 'strong',
      model,
    });
    const raw = completion.choices[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);
    if (parsed) {
      const decision = QaDecisionSchema.parse(parsed);
      if (decision.isDuplicate && decision.duplicateTicketId) {
        const ref = String(decision.duplicateTicketId).trim();
        const match = tickets.find(
          (t) =>
            t.id === ref ||
            t.key === ref ||
            t.issueKey === ref ||
            t.key?.toUpperCase() === ref.toUpperCase() ||
            t.issueKey?.toUpperCase() === ref.toUpperCase()
        );
        if (!match) {
          return { ...decision, isDuplicate: false, duplicateTicketId: undefined };
        }
        decision.duplicateTicketId = match.key || match.issueKey || match.id;
      }
      if (decision.isIssue && decision.issue && !decision.issue.projectId) {
        decision.issue.projectId = primaryProjectId;
      }
      return decision;
    }
  } catch (err) {
    console.warn('QA Lead LLM failed', err);
    pushAgentCall(agentCalls, {
      agent: 'QA_LEAD',
      tier: 'strong',
      skipped: true,
      reason: 'llm_failed',
    });
  }

  // Conservative fallback
  const cat = input.analysis.category;
  if (cat === 'FEATURE_REQUEST') {
    return {
      isIssue: true,
      classification: 'FEATURE_REQUEST',
      reason: 'Customer requested a new capability.',
      recommendedResponse: '',
      isDuplicate: false,
      issue: {
        title: input.analysis.summary || input.message.slice(0, 80),
        type: 'FEATURE_REQUEST',
        priority: 'MEDIUM',
        severity: 'MEDIUM',
        description: input.message,
        stepsToReproduce: [],
        expectedBehavior: '',
        actualBehavior: '',
        projectId: primaryProjectId,
      },
    };
  }
  if (cat === 'CHANGE_REQUEST') {
    return {
      isIssue: true,
      classification: 'CHANGE_REQUEST',
      reason: 'Customer requested a behavior change.',
      recommendedResponse: '',
      isDuplicate: false,
      issue: {
        title: input.analysis.summary || input.message.slice(0, 80),
        type: 'CHANGE_REQUEST',
        priority: 'MEDIUM',
        severity: 'MEDIUM',
        description: input.message,
        stepsToReproduce: [],
        expectedBehavior: '',
        actualBehavior: '',
        projectId: primaryProjectId,
      },
    };
  }
  if (input.analysis.isIssue || cat === 'BUG_REPORT' || cat === 'ISSUE_REPORT') {
    return {
      isIssue: true,
      classification: 'BUG',
      reason: 'Potential defect reported by customer.',
      recommendedResponse: '',
      isDuplicate: false,
      issue: {
        title: input.analysis.possibleIssue || input.analysis.summary || input.message.slice(0, 80),
        type: 'BUG',
        priority: 'HIGH',
        severity: 'HIGH',
        description: input.message,
        stepsToReproduce: [],
        expectedBehavior: '',
        actualBehavior: input.message,
        projectId: primaryProjectId,
      },
    };
  }

  return {
    isIssue: false,
    classification: 'NOT_AN_ISSUE',
    reason: 'Insufficient evidence of a product defect.',
    recommendedResponse:
      'Please share more detail (steps, expected vs actual, screenshot) so we can help.',
    isDuplicate: false,
  };
}
