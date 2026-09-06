import { z } from 'zod';

export const SupportCategorySchema = z.enum([
  'GENERAL_QUESTION',
  'SUPPORT_REQUEST',
  'BUG_REPORT',
  'ISSUE_REPORT',
  'CHANGE_REQUEST',
  'FEATURE_REQUEST',
  'FOLLOW_UP',
  'STATUS_REQUEST',
  'COMPLAINT',
  'GENERAL_CONVERSATION',
  'OTHER',
]);

export type SupportCategory = z.infer<typeof SupportCategorySchema>;

export const ChatAnalysisSchema = z.object({
  intent: z.string().default(''),
  category: SupportCategorySchema.default('OTHER'),
  sentiment: z.string().default('neutral'),
  isSupportRequest: z.boolean().default(false),
  isIssue: z.boolean().default(false),
  isFollowUp: z.boolean().default(false),
  isReply: z.boolean().default(false),
  relatedMessageIds: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  summary: z.string().default(''),
  entities: z.array(z.string()).default([]),
  possibleIssue: z.string().default(''),
});

export type ChatAnalysis = z.infer<typeof ChatAnalysisSchema>;

export const QaClassificationSchema = z.enum([
  'BUG',
  'CHANGE_REQUEST',
  'FEATURE_REQUEST',
  'CONFIGURATION_ISSUE',
  'USER_ERROR',
  'NOT_REPRODUCIBLE',
  'NOT_AN_ISSUE',
]);

export const QaDecisionSchema = z.object({
  isIssue: z.boolean(),
  classification: QaClassificationSchema,
  reason: z.string().default(''),
  recommendedResponse: z.string().default(''),
  isDuplicate: z.boolean().default(false),
  duplicateTicketId: z.string().optional(),
  issue: z
    .object({
      title: z.string(),
      type: z.enum(['BUG', 'CHANGE_REQUEST', 'FEATURE_REQUEST']),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
      description: z.string().default(''),
      stepsToReproduce: z.array(z.string()).default([]),
      expectedBehavior: z.string().default(''),
      actualBehavior: z.string().default(''),
      affectedModule: z.string().optional(),
      projectId: z.string().optional(),
    })
    .optional(),
});

export type QaDecision = z.infer<typeof QaDecisionSchema>;

export const SupportEngineerDecisionSchema = z.object({
  action: z.enum(['REPLY', 'ESCALATE_QA']),
  customerReply: z.string().default(''),
  escalateReason: z.string().optional(),
  state: z
    .enum([
      'ANALYZING',
      'WAITING_FOR_CONTEXT',
      'RESPONDING',
      'ESCALATED_TO_QA',
      'WAITING_FOR_QA',
      'COMPLETED',
    ])
    .default('COMPLETED'),
});

export type SupportEngineerDecision = z.infer<
  typeof SupportEngineerDecisionSchema
>;

export function supportChatModel(): string {
  return (
    process.env.SUPPORT_CHAT_MODEL?.trim() ||
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    'qwen/qwen3.8-27b'
  );
}

export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
