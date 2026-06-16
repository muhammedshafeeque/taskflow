import { z } from 'zod';

export const createWorkLogSchema = z.object({
  body: z.object({
    minutesSpent: z.number().int().positive(),
    date: z.string().min(1), // ISO date (YYYY-MM-DD) or full ISO
    description: z.string().max(2000).optional(),
    laneId: z.string().max(64).optional(),
    overrunReason: z.string().max(2000).optional(),
  }),
  params: z.object({
    issueId: z.string().min(1),
  }),
});

export const updateWorkLogSchema = z.object({
  body: z.object({
    minutesSpent: z.number().int().positive().optional(),
    date: z.string().min(1).optional(),
    description: z.string().max(2000).optional(),
  }),
  params: z.object({
    issueId: z.string().min(1),
    id: z.string().min(1),
  }),
});

export const workLogIdParamSchema = z.object({
  params: z.object({
    issueId: z.string().min(1),
    id: z.string().min(1),
  }),
});

export const issueIdOnlyParamSchema = z.object({
  params: z.object({
    issueId: z.string().min(1),
  }),
});

export const globalTimesheetQuerySchema = z.object({
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

export const timesheetDetailsQuerySchema = z.object({
  query: z.object({
    userId: z.string().min(1),
    date: z.string().min(1),
  }),
});

export const timesheetExportQuerySchema = z.object({
  query: z.object({
    startDate: z.string().min(1),
    endDate: z.string().min(1),
  }),
});

