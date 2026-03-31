import { z } from 'zod';

export const createIssueSchema = z.object({
  body: z.object({
    title: z.string().min(1),
    description: z.string().optional(),
    type: z.string().optional(),
    priority: z.string().optional(),
    status: z.string().optional(),
    assignee: z.string().optional(),
    project: z.string().min(1),
    sprint: z.string().optional().nullable(),
    boardColumn: z.string().optional(),
    labels: z.array(z.string()).optional(),
    dueDate: z.string().optional(),
    startDate: z.string().optional(),
    storyPoints: z.number().optional().nullable(),
    timeEstimateMinutes: z.number().optional(),
    checklist: z.array(z.object({
      id: z.string(),
      text: z.string(),
      done: z.boolean(),
    })).optional(),
    customFieldValues: z.record(z.unknown()).optional(),
    fixVersion: z.string().optional(),
    affectsVersions: z.array(z.string()).optional(),
    parent: z.string().optional().nullable(),
    milestone: z.string().optional().nullable(),
  }),
});

export const updateIssueSchema = z.object({
  body: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    type: z.string().optional(),
    priority: z.string().optional(),
    status: z.string().optional(),
    assignee: z.string().optional().nullable(),
    sprint: z.string().optional().nullable(),
    boardColumn: z.string().optional(),
    labels: z.array(z.string()).optional(),
    dueDate: z.string().optional().nullable(),
    startDate: z.string().optional().nullable(),
    storyPoints: z.number().optional().nullable(),
    timeEstimateMinutes: z.number().optional().nullable(),
    checklist: z.array(z.object({
      id: z.string(),
      text: z.string(),
      done: z.boolean(),
    })).optional(),
    customFieldValues: z.record(z.unknown()).optional(),
    fixVersion: z.string().optional().nullable(),
    affectsVersions: z.array(z.string()).optional(),
    parent: z.string().optional().nullable(),
    milestone: z.string().optional().nullable(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const issueIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

export const exportIssuesQuerySchema = z.object({
  query: z.object({
    project: z.union([z.string(), z.array(z.string())]).optional(),
    jql: z.string().optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    assignee: z.union([z.string(), z.array(z.string())]).optional(),
    reporter: z.union([z.string(), z.array(z.string())]).optional(),
    sprint: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    priority: z.union([z.string(), z.array(z.string())]).optional(),
    labels: z.union([z.string(), z.array(z.string())]).optional(),
    storyPoints: z.union([z.string(), z.array(z.string())]).optional(),
    hasStoryPoints: z.enum(['true', 'false']).optional(),
    hasEstimate: z.enum(['true', 'false']).optional(),
    fixVersion: z.string().optional(),
  }),
});

export const listIssuesQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    project: z.union([z.string(), z.array(z.string())]).optional(),
    status: z.union([z.string(), z.array(z.string())]).optional(),
    assignee: z.union([z.string(), z.array(z.string())]).optional(),
    reporter: z.union([z.string(), z.array(z.string())]).optional(),
    sprint: z.string().optional(),
    type: z.union([z.string(), z.array(z.string())]).optional(),
    priority: z.union([z.string(), z.array(z.string())]).optional(),
    labels: z.union([z.string(), z.array(z.string())]).optional(),
    storyPoints: z.union([z.string(), z.array(z.string())]).optional(),
    hasStoryPoints: z.enum(['true', 'false']).optional(),
    hasEstimate: z.enum(['true', 'false']).optional(),
    fixVersion: z.string().optional(),
  }),
});

export const searchIssuesQuerySchema = z.object({
  query: z.object({
    project: z.string().min(1),
    q: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const jqlQuerySchema = z.object({
  query: z.object({
    jql: z.string().min(1),
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
});

export const searchGlobalQuerySchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.string().optional(),
    limit: z.string().optional(),
    excludeIssueId: z.string().optional(),
  }),
});

export const byKeyQuerySchema = z.object({
  query: z.object({
    project: z.string().min(1),
    key: z.string().min(1),
  }),
});

export const createIssueLinkSchema = z.object({
  body: z.object({
    targetIssueId: z.string().min(1),
    linkType: z.enum(['blocks', 'is_blocked_by', 'duplicates', 'is_duplicated_by', 'relates_to']),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

export const deleteIssueLinkParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    linkId: z.string().min(1),
  }),
});

export const bulkUpdateSchema = z.object({
  body: z.object({
    issueIds: z.array(z.string().min(1)).min(1).max(100),
    updates: z.object({
      status: z.string().optional(),
      assignee: z.string().nullable().optional(),
      sprint: z.string().nullable().optional(),
      storyPoints: z.number().nullable().optional(),
      labels: z.array(z.string()).optional(),
      type: z.string().optional(),
      priority: z.string().optional(),
      fixVersion: z.string().nullable().optional(),
    }).refine((u) => Object.keys(u).length > 0, { message: 'At least one update field required' }),
  }),
});

export const bulkDeleteSchema = z.object({
  body: z.object({
    issueIds: z.array(z.string().min(1)).min(1).max(100),
  }),
});

export const backlogOrderSchema = z.object({
  body: z.object({
    issueIds: z.array(z.string().min(1)).min(1).max(500),
  }),
});

export type CreateIssueBody = z.infer<typeof createIssueSchema>['body'];
export type UpdateIssueBody = z.infer<typeof updateIssueSchema>['body'];
export type ListIssuesQuery = z.infer<typeof listIssuesQuerySchema>['query'];
