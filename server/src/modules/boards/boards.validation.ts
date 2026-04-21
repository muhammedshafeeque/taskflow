import { z } from 'zod';

const boardTypeEnum = z.enum(['Kanban', 'Scrum']);
const columnSchema = z.object({
  name: z.string().min(1),
  statusId: z.string().min(1),
  visibleStatuses: z.array(z.string().min(1)).optional(),
  order: z.number().int().min(0),
});

export const createBoardSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    type: boardTypeEnum,
    project: z.string().min(1),
    columns: z.array(columnSchema).optional(),
  }),
});

export const updateBoardSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    type: boardTypeEnum.optional(),
    columns: z.array(columnSchema).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const boardIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export type CreateBoardBody = z.infer<typeof createBoardSchema>['body'];
export type UpdateBoardBody = z.infer<typeof updateBoardSchema>['body'];
