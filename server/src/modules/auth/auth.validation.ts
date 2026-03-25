import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    role: z.enum(['user', 'admin']).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(1),
  }),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
  }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1),
    newPassword: z.string().min(6),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    avatarUrl: z
      .string()
      .optional()
      .refine((v) => !v || v === '' || v.startsWith('/api/uploads/'), {
        message: 'avatarUrl must be empty or a valid upload path',
      }),
  }),
});

export const microsoftSsoSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    redirectUri: z.string().url().optional(),
  }),
});

export const microsoftSsoAuthorizeUrlQuerySchema = z.object({
  query: z.object({
    redirectUri: z.string().url().optional(),
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>['body'];
export type LoginInput = z.infer<typeof loginSchema>['body'];
export type RefreshInput = z.infer<typeof refreshSchema>['body'];
export type MicrosoftSsoInput = z.infer<typeof microsoftSsoSchema>['body'];
export type MicrosoftSsoAuthorizeUrlQuery = z.infer<typeof microsoftSsoAuthorizeUrlQuerySchema>['query'];
