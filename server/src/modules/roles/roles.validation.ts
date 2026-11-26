import { z } from 'zod';

const roleIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

const createRoleSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    permissions: z.array(z.string().min(1)),
    inherits: z.array(z.string().min(1)).max(20).optional(),
  }),
});

const updateRoleSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    permissions: z.array(z.string().min(1)).optional(),
    inherits: z.array(z.string().min(1)).max(20).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const rolesValidation = {
  roleIdParam: roleIdParamSchema,
  createRole: createRoleSchema,
  updateRole: updateRoleSchema,
};

export type CreateRoleBody = z.infer<typeof createRoleSchema>['body'];
export type UpdateRoleBody = z.infer<typeof updateRoleSchema>['body'];
