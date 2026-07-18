import mongoose, { Document, Schema } from 'mongoose';

export interface IProjectStatus {
  id: string;
  name: string;
  order: number;
  isClosed?: boolean;
  icon?: string;
  color?: string;
  fontColor?: string;
  /** Work lane id when this status represents in-progress work (e.g. dev, qa) */
  userInLane?: string;
}

export interface IProjectIssueType {
  id: string;
  name: string;
  order: number;
  icon?: string;
  color?: string;
  fontColor?: string;
}

export interface IProjectPriority {
  id: string;
  name: string;
  order: number;
  icon?: string;
  color?: string;
  fontColor?: string;
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'user' | 'formula';

export interface IProjectCustomField {
  id: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options?: string[]; // for select / multiselect
  order: number;
  /** Expression for fieldType formula, e.g. {storyPoints} * 8 or daysBetween({startDate},{dueDate}) */
  formula?: string;
}

export interface IFieldSchemeRule {
  fieldKey: string;
  visible: boolean;
  required?: boolean;
}

export interface IFieldScheme {
  issueTypeId: string;
  rules: IFieldSchemeRule[];
}

export type RuleTrigger =
  | 'issue.created'
  | 'issue.updated'
  | 'estimate.submitted'
  | 'worklog.creating'
  | 'comment.creating';

export type RuleConditionOp = 'eq' | 'neq' | 'exists' | 'gt';

export interface IProjectRuleCondition {
  field: string;
  op: RuleConditionOp;
  value?: unknown;
}

export type IProjectRuleAction =
  | { type: 'deny'; message: string; unlessPermission?: string }
  | { type: 'require_approval'; permission: string }
  | { type: 'require_field'; field: string }
  | { type: 'notify'; eventKey: string };

export interface IProjectRule {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  mode: 'log' | 'enforce';
  trigger: RuleTrigger;
  conditions: IProjectRuleCondition[];
  actions: IProjectRuleAction[];
}

export type ProjectVersionStatus = 'unreleased' | 'released' | 'archived';

export interface IProjectVersion {
  id: string;
  name: string;
  description?: string;
  releaseDate?: Date;
  status: ProjectVersionStatus;
  order: number;
  /** Environment ids this version is mapped to (for planning / release targeting) */
  mappedEnvironmentIds?: string[];
  /** When this version was released to each environment (ISO date string) */
  releasedAtByEnvironment?: Record<string, string>;
  /** Auto-generated release notes per environment */
  releaseNotesByEnvironment?: Record<string, string>;
}

export interface IProjectEnvironment {
  id: string;
  name: string;
  order: number;
}

export interface IProjectReleaseRule {
  environmentId: string;
  statusName: string; // status to set on issues when releasing to this env
  /** Optional: user id to assign released issues to */
  assigneeId?: string;
  /** Optional: user ids to notify when release happens */
  notifyUserIds?: string[];
  /** Optional: how to notify - email, in_app, third_party */
  notifyChannels?: ('email' | 'in_app' | 'third_party')[];
}

export interface IProject extends Document {
  name: string;
  key: string;
  description: string;
  lead: mongoose.Types.ObjectId;
  archived: boolean;
  /** TaskFlow workspace (internal organization) */
  taskflowOrganizationId?: mongoose.Types.ObjectId;
  /** Optional link to a customer portal org (client) */
  orgId?: mongoose.Types.ObjectId;
  /** Optional link to CRM account */
  crmAccountId?: mongoose.Types.ObjectId;
  nextIssueNumber: number;
  statuses: IProjectStatus[];
  issueTypes: IProjectIssueType[];
  priorities: IProjectPriority[];
  customFields: IProjectCustomField[];
  /** Per issue-type visibility and required overrides for custom fields */
  fieldSchemes: IFieldScheme[];
  versions: IProjectVersion[];
  environments: IProjectEnvironment[];
  releaseRules: IProjectReleaseRule[];
  /** Opt-in estimate approval workflow */
  estimateApprovalEnabled?: boolean;
  /** Global rules mode when estimate approval / rules active */
  rulesEnforcementMode?: 'log' | 'enforce';
  projectRules: IProjectRule[];
  createdAt: Date;
  updatedAt: Date;
}

const projectStatusSchema = new Schema<IProjectStatus>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, required: true },
    isClosed: { type: Boolean, default: undefined },
    icon: { type: String, default: undefined },
    color: { type: String, default: undefined },
    fontColor: { type: String, default: undefined },
    userInLane: { type: String, default: undefined },
  },
  { _id: false }
);

const projectIssueTypeSchema = new Schema<IProjectIssueType>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, required: true },
    icon: { type: String, default: undefined },
    color: { type: String, default: undefined },
    fontColor: { type: String, default: undefined },
  },
  { _id: false }
);

const projectPrioritySchema = new Schema<IProjectPriority>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    order: { type: Number, required: true },
    icon: { type: String, default: undefined },
    color: { type: String, default: undefined },
    fontColor: { type: String, default: undefined },
  },
  { _id: false }
);

const projectCustomFieldSchema = new Schema<IProjectCustomField>(
  {
    id: { type: String, required: true },
    key: { type: String, required: true },
    label: { type: String, required: true },
    fieldType: {
      type: String,
      enum: ['text', 'number', 'date', 'select', 'multiselect', 'user', 'formula'],
      required: true,
    },
    required: { type: Boolean, default: false },
    options: { type: [String], default: undefined },
    order: { type: Number, required: true },
    formula: { type: String, default: undefined },
  },
  { _id: false }
);

const fieldSchemeRuleSchema = new Schema(
  {
    fieldKey: { type: String, required: true },
    visible: { type: Boolean, required: true },
    required: { type: Boolean, default: undefined },
  },
  { _id: false }
);

const fieldSchemeSchema = new Schema(
  {
    issueTypeId: { type: String, required: true },
    rules: { type: [fieldSchemeRuleSchema], default: [] },
  },
  { _id: false }
);

const projectVersionSchema = new Schema<IProjectVersion>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    releaseDate: { type: Date },
    status: { type: String, enum: ['unreleased', 'released', 'archived'], required: true, default: 'unreleased' },
    order: { type: Number, required: true },
    mappedEnvironmentIds: { type: [String], default: undefined },
    releasedAtByEnvironment: { type: Schema.Types.Mixed, default: undefined },
    releaseNotesByEnvironment: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const projectEnvironmentSchema = new Schema<IProjectEnvironment>(
  { id: { type: String, required: true }, name: { type: String, required: true }, order: { type: Number, required: true } },
  { _id: false }
);

const projectReleaseRuleSchema = new Schema<IProjectReleaseRule>(
  {
    environmentId: { type: String, required: true },
    statusName: { type: String, required: true },
    assigneeId: { type: String, default: undefined },
    notifyUserIds: { type: [String], default: undefined },
    notifyChannels: { type: [String], enum: ['email', 'in_app', 'third_party'], default: undefined },
  },
  { _id: false }
);

const projectRuleSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    mode: { type: String, enum: ['log', 'enforce'], default: 'enforce' },
    trigger: {
      type: String,
      enum: ['issue.created', 'issue.updated', 'estimate.submitted', 'worklog.creating', 'comment.creating'],
      required: true,
    },
    conditions: { type: [Schema.Types.Mixed], default: [] },
    actions: { type: [Schema.Types.Mixed], default: [] },
  },
  { _id: false }
);

const projectSchema = new Schema<IProject>(
  {
    name: { type: String, required: true },
    key: { type: String, required: true, uppercase: true },
    description: { type: String, default: '' },
    lead: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    archived: { type: Boolean, default: false },
    taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    orgId: { type: Schema.Types.ObjectId, ref: 'CustomerOrg', default: null },
    crmAccountId: { type: Schema.Types.ObjectId, ref: 'CrmAccount', default: null, index: true },
    nextIssueNumber: { type: Number, default: 1 },
    statuses: { type: [projectStatusSchema], default: undefined },
    issueTypes: { type: [projectIssueTypeSchema], default: undefined },
    priorities: { type: [projectPrioritySchema], default: undefined },
    customFields: { type: [projectCustomFieldSchema], default: undefined },
    fieldSchemes: { type: [fieldSchemeSchema], default: [] },
    versions: { type: [projectVersionSchema], default: undefined },
    environments: { type: [projectEnvironmentSchema], default: undefined },
    releaseRules: { type: [projectReleaseRuleSchema], default: undefined },
    estimateApprovalEnabled: { type: Boolean, default: false },
    rulesEnforcementMode: { type: String, enum: ['log', 'enforce'], default: 'enforce' },
    projectRules: { type: [projectRuleSchema], default: [] },
  },
  { timestamps: true }
);

/** Unique project key per TaskFlow organization (legacy rows without org are not in this index). */
projectSchema.index(
  { taskflowOrganizationId: 1, key: 1 },
  {
    unique: true,
    // Use $type only — `$ne: null` is rewritten to `$not` and is not allowed in partial indexes on some MongoDB versions.
    partialFilterExpression: { taskflowOrganizationId: { $type: 'objectId' } },
  }
);

export const Project = mongoose.model<IProject>('Project', projectSchema);
