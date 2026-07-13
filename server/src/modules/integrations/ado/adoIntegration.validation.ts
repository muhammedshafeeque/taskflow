import { z } from 'zod';

export const saveAdoIntegrationSchema = z.object({
  body: z.object({
    enabled: z.boolean(),
    org: z.string().min(1),
    adoProject: z.string().min(1),
    pat: z.string().optional(),
    statusMap: z.record(z.string()).optional(),
    typeMap: z.record(z.string()).optional(),
    defaultWorkItemType: z.string().optional(),
    autoSyncEnabled: z.boolean().optional(),
    autoSyncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
  }),
});

export const testAdoIntegrationSchema = z.object({
  body: z.object({
    org: z.string().min(1),
    adoProject: z.string().min(1),
    pat: z.string().optional(),
  }),
});

export const projectIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});
