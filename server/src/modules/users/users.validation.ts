import { z } from 'zod';

export const userIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const updateUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    role: z.enum(['user', 'admin']).optional(),
    roleId: z.string().min(1).optional().nullable(),
    designationId: z.string().min(1).optional().nullable(),
    enabled: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const inviteUserSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    designationId: z.string().min(1).optional().nullable(),
    roleId: z.string().min(1),
    /** Existing accounts: also change their role to roleId (a role applies in every workspace). */
    applyRole: z.boolean().optional(),
    /** Connect the account to an HR employee record (AUT-35). Default: link the one unlinked employee with this email. */
    employee: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('auto') }),
        z.object({ mode: z.literal('none') }),
        z.object({ mode: z.literal('link'), employeeId: z.string().min(1) }),
        z.object({
          mode: z.literal('create'),
          employeeCode: z.string().max(40).optional(),
          department: z.string().max(120).optional(),
          designation: z.string().max(120).optional(),
          joinedDate: z.string().max(40).optional(),
          managerId: z.string().max(40).optional(),
          level: z.string().max(60).optional(),
        }),
      ])
      .optional(),
  }),
});

export const updatePermissionOverridesSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    granted: z.array(z.string()).default([]),
    revoked: z.array(z.string()).default([]),
  }),
});

export const usersValidation = {
  userIdParam: userIdParamSchema,
  updateUser: updateUserSchema,
  inviteUser: inviteUserSchema,
  updatePermissionOverrides: updatePermissionOverridesSchema,
};

export type UpdateUserBody = z.infer<typeof updateUserSchema>['body'];
export type InviteUserBody = z.infer<typeof inviteUserSchema>['body'];
