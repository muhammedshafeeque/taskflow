import { z } from 'zod';

const stageEstimateItemSchema = z.object({
  laneId: z.string().min(1).max(64),
  minutes: z.number().min(0),
  statusId: z.string().optional(),
  assigneeId: z.string().optional(),
});

export const stageEstimatesValidation = {
  issueIdParam: z.object({ params: z.object({ id: z.string().min(1) }) }),
  estimateIdParam: z.object({
    params: z.object({ id: z.string().min(1), estimateId: z.string().min(1) }),
  }),
  submit: z.object({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ estimates: z.array(stageEstimateItemSchema).min(1) }),
  }),
  reject: z.object({
    params: z.object({ id: z.string().min(1), estimateId: z.string().min(1) }),
    body: z.object({ rejectNote: z.string().min(1).max(2000) }),
  }),
  approve: z.object({
    params: z.object({ id: z.string().min(1), estimateId: z.string().min(1) }),
    body: z
      .object({
        note: z.string().max(2000).optional(),
        force: z.boolean().optional(),
      })
      .default({}),
  }),
};
