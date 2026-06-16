import { z } from 'zod';

const metaItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
  isClosed: z.boolean().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  fontColor: z.string().optional(),
  userInLane: z.string().max(64).optional(),
});

const customFieldSchema = z.object({
  id: z.string(),
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  fieldType: z.enum(['text', 'number', 'date', 'select', 'multiselect', 'user', 'formula']),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  order: z.number(),
  formula: z.string().max(500).optional(),
});

const fieldSchemeRuleSchema = z.object({
  fieldKey: z.string(),
  visible: z.boolean(),
  required: z.boolean().optional(),
});

const fieldSchemeSchema = z.object({
  issueTypeId: z.string(),
  rules: z.array(fieldSchemeRuleSchema),
});

export const projectTemplatesValidation = {
  patch: z.object({
    params: z.object({ id: z.string().min(1) }),
    body: z
      .object({
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).optional(),
        statuses: z.array(metaItemSchema).optional(),
        issueTypes: z.array(metaItemSchema).optional(),
        priorities: z.array(metaItemSchema).optional(),
        customFields: z.array(customFieldSchema).optional(),
        fieldSchemes: z.array(fieldSchemeSchema).optional(),
        projectRules: z.array(z.record(z.unknown())).optional(),
        estimateApprovalEnabled: z.boolean().optional(),
        rulesEnforcementMode: z.enum(['log', 'enforce']).optional(),
        isLibrary: z.boolean().optional(),
        changelog: z.string().max(200).optional(),
      })
      .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' }),
  }),
  restore: z.object({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ version: z.number().int().min(1) }),
  }),
};
