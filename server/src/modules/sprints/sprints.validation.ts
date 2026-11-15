import { z } from 'zod';

const sprintStatusEnum = z.enum(['planned', 'active', 'completed']);

export const createSprintSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    project: z.string().min(1),
    /** Scrum board of the project; omitted → the project's Scrum board (created if it has none). */
    board: z.string().min(1).optional(),
    startDate: z.union([z.string(), z.date()]).optional(),
    endDate: z.union([z.string(), z.date()]).optional(),
    status: sprintStatusEnum.optional(),
  }),
});

export const updateSprintSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    /** Move the sprint to another Scrum board of the same project. */
    board: z.string().min(1).optional(),
    startDate: z.union([z.string(), z.date()]).optional(),
    endDate: z.union([z.string(), z.date()]).optional(),
    status: sprintStatusEnum.optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const sprintIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type CreateSprintBody = z.infer<typeof createSprintSchema>['body'];
export type UpdateSprintBody = z.infer<typeof updateSprintSchema>['body'];
