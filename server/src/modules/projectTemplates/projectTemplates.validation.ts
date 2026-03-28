import { z } from 'zod';

const metaItemSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
  icon: z.string().optional(),
  color: z.string().optional(),
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
      })
      .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' }),
  }),
};
