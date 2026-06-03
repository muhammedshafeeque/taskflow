import { z } from 'zod';

export const startImportSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    source: z.enum(['ado', 'csv', 'jira']),
    dryRun: z.boolean().optional(),
    skipExisting: z.boolean().optional(),
    reporterEmail: z.string().email(),
    options: z.record(z.unknown()).optional(),
    csvContent: z.string().optional(),
  }),
});

export const importJobParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    jobId: z.string().min(1),
  }),
});
