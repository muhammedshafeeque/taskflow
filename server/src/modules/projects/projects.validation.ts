import { z } from 'zod';

const projectStatusSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
  isClosed: z.boolean().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  fontColor: z.string().optional(),
});
const projectIssueTypeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
  icon: z.string().optional(),
  color: z.string().optional(),
  fontColor: z.string().optional(),
});
const projectPrioritySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
  icon: z.string().optional(),
  color: z.string().optional(),
  fontColor: z.string().optional(),
});
const customFieldTypeEnum = z.enum(['text', 'number', 'date', 'select', 'multiselect', 'user']);
const projectCustomFieldSchema = z.object({
  id: z.string(),
  key: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Key must start with a letter and contain only letters, numbers, underscore'),
  label: z.string().min(1),
  fieldType: customFieldTypeEnum,
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  order: z.number(),
});

const projectVersionStatusEnum = z.enum(['unreleased', 'released', 'archived']);
const projectVersionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  releaseDate: z.string().optional(),
  status: projectVersionStatusEnum,
  order: z.number(),
  mappedEnvironmentIds: z.array(z.string()).optional(),
  releasedAtByEnvironment: z.record(z.string()).optional(),
  releaseNotesByEnvironment: z.record(z.string()).optional(),
});

const projectEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  order: z.number(),
});

const projectReleaseRuleSchema = z.object({
  environmentId: z.string(),
  statusName: z.string().min(1),
  assigneeId: z.string().optional(),
  notifyUserIds: z.array(z.string()).optional(),
  notifyChannels: z.array(z.enum(['email', 'in_app', 'third_party'])).optional(),
});

const createProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    key: z.string().min(1).max(10).transform((s) => s.toUpperCase()),
    description: z.string().optional(),
    lead: z.string().min(1),
    templateId: z.string().optional(),
  }),
});

const updateProjectSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    key: z.string().min(1).max(10).transform((s) => s.toUpperCase()).optional(),
    description: z.string().optional(),
    lead: z.string().min(1).optional(),
    /** When set, replaces statuses, issueTypes, and priorities from this template (built-in id: `default`). */
    templateId: z.string().optional(),
    statuses: z.array(projectStatusSchema).optional(),
    issueTypes: z.array(projectIssueTypeSchema).optional(),
    priorities: z.array(projectPrioritySchema).optional(),
    customFields: z.array(projectCustomFieldSchema).optional(),
    versions: z.array(projectVersionSchema).optional(),
    environments: z.array(projectEnvironmentSchema).optional(),
    releaseRules: z.array(projectReleaseRuleSchema).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

const idParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});

const saveSettingsTemplateSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  body: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
  }),
});

const releaseVersionBodySchema = z.object({
  body: z.object({
    versionId: z.string().min(1),
    environmentId: z.string().min(1),
    issueIds: z.array(z.string()).optional(), // if provided, only these issues are included; others with this fixVersion get fixVersion cleared
  }),
  params: z.object({
    id: z.string().min(1),
  }),
});

const inviteProjectSchema = z.object({
  body: z.object({
    email: z.string().email(),
    roleId: z.string().min(1).optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
});

const invitationIdParamSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    invitationId: z.string().min(1).optional(),
  }),
});

const cancelInvitationParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    invitationId: z.string().min(1),
  }),
});

const timesheetQuerySchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }),
});

const sprintReportParamsSchema = z.object({
  params: z.object({
    id: z.string().min(1),
    sprintId: z.string().min(1),
  }),
});

export const projectsValidation = {
  create: createProjectSchema,
  update: updateProjectSchema,
  idParam: idParamSchema,
  saveSettingsTemplate: saveSettingsTemplateSchema,
  releaseVersion: releaseVersionBodySchema,
  inviteProject: inviteProjectSchema,
  invitationIdParam: invitationIdParamSchema,
  cancelInvitationParams: cancelInvitationParamsSchema,
  timesheetQuery: timesheetQuerySchema,
  sprintReportParams: sprintReportParamsSchema,
};

export type CreateProjectBody = z.infer<typeof createProjectSchema>['body'];
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>['body'];
