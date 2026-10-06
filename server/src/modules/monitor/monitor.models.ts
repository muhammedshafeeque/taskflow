import mongoose, { Document, Schema } from 'mongoose';

const orgIdx = { taskflowOrganizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true } };

export interface IMonitorProject extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  name: string;
  key: string;
  sourceProjectId?: mongoose.Types.ObjectId;
  /** Rotation: whoever is on call gets paged for new errors, regressions and outages. */
  onCall?: { userIds: mongoose.Types.ObjectId[]; rotationDays: number; startsAt: Date; enabled: boolean };
  createdAt: Date;
  updatedAt: Date;
}

const monitorProjectSchema = new Schema<IMonitorProject>(
  {
    ...orgIdx,
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, trim: true, uppercase: true },
    sourceProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    onCall: {
      enabled: { type: Boolean, default: false },
      userIds: { type: [{ type: Schema.Types.ObjectId, ref: 'User' }], default: [] },
      rotationDays: { type: Number, default: 7, min: 1, max: 90 },
      startsAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);
monitorProjectSchema.index({ taskflowOrganizationId: 1, key: 1 }, { unique: true });
monitorProjectSchema.index(
  { taskflowOrganizationId: 1, sourceProjectId: 1 },
  { unique: true, sparse: true }
);
export const MonitorProject = mongoose.model<IMonitorProject>('MonitorProject', monitorProjectSchema);

export type MonitorAppKind = 'web' | 'server' | 'mobile' | 'admin' | 'portal' | 'other';

export interface IMonitorEnvironment extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

const environmentSchema = new Schema<IMonitorEnvironment>(
  {
    ...orgIdx,
    projectId: { type: Schema.Types.ObjectId, ref: 'MonitorProject', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
  },
  { timestamps: true }
);
environmentSchema.index({ taskflowOrganizationId: 1, projectId: 1, slug: 1 }, { unique: true });
export const MonitorEnvironment = mongoose.model<IMonitorEnvironment>('MonitorEnvironment', environmentSchema);

export interface IMonitorApp extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  environmentId: mongoose.Types.ObjectId;
  name: string;
  kind: MonitorAppKind;
  keyPrefix: string;
  keyHash: string;
  revokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const appSchema = new Schema<IMonitorApp>(
  {
    ...orgIdx,
    projectId: { type: Schema.Types.ObjectId, ref: 'MonitorProject', required: true, index: true },
    environmentId: { type: Schema.Types.ObjectId, ref: 'MonitorEnvironment', required: true, index: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['web', 'server', 'mobile', 'admin', 'portal', 'other'], default: 'web' },
    keyPrefix: { type: String, required: true },
    keyHash: { type: String, required: true, unique: true },
    revokedAt: { type: Date },
  },
  { timestamps: true }
);
export const MonitorApp = mongoose.model<IMonitorApp>('MonitorApp', appSchema);

const ttl14 = 14 * 24 * 60 * 60;
const ttl90 = 90 * 24 * 60 * 60;

export const MonitorLog = mongoose.model(
  'MonitorLog',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true, index: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      level: { type: String, default: 'info' },
      message: { type: String, required: true },
      release: { type: String },
      meta: { type: Schema.Types.Mixed },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);

export const MonitorErrorEvent = mongoose.model(
  'MonitorErrorEvent',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      fingerprint: { type: String, required: true, index: true },
      type: { type: String },
      message: { type: String, required: true },
      stack: { type: String },
      kind: { type: String, default: 'unhandled' },
      release: { type: String },
      breadcrumbs: { type: [Schema.Types.Mixed], default: [] },
      userAgent: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl90 })
);

export const MonitorErrorGroup = mongoose.model(
  'MonitorErrorGroup',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      fingerprint: { type: String, required: true },
      type: { type: String },
      message: { type: String, required: true },
      sampleStack: { type: String },
      kind: { type: String, default: 'unhandled' },
      count: { type: Number, default: 1 },
      status: { type: String, enum: ['open', 'resolved'], default: 'open' },
      firstSeen: { type: Date, default: Date.now },
      lastSeen: { type: Date, default: Date.now, index: true },
      // Incident workflow
      assigneeId: { type: Schema.Types.ObjectId, ref: 'User' },
      acknowledgedAt: { type: Date },
      acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      /** Alerts for this group are muted until this time. */
      snoozedUntil: { type: Date },
      /** Set when a resolved group receives a new event. */
      regressedAt: { type: Date },
      resolvedAt: { type: Date },
      linkedIssueId: { type: Schema.Types.ObjectId, ref: 'Issue' },
      linkedIssueKey: { type: String },
      linkedProjectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    },
    { timestamps: true }
  ).index({ appId: 1, fingerprint: 1 }, { unique: true })
);

export const MonitorPresence = mongoose.model(
  'MonitorPresence',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      sessionId: { type: String, required: true },
      userId: { type: String },
      page: { type: String },
      userAgent: { type: String },
      lastSeen: { type: Date, default: Date.now },
    },
    { timestamps: false }
  )
    .index({ lastSeen: 1 }, { expireAfterSeconds: 5 * 60 })
    .index({ appId: 1, sessionId: 1 }, { unique: true })
);

export const MonitorTransaction = mongoose.model(
  'MonitorTransaction',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      name: { type: String, required: true },
      durationMs: { type: Number, required: true },
      status: { type: String },
      release: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);

export const MonitorHttpCall = mongoose.model(
  'MonitorHttpCall',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      method: { type: String, default: 'GET' },
      url: { type: String, required: true },
      status: { type: Number },
      durationMs: { type: Number },
      direction: { type: String, enum: ['in', 'out'], default: 'out' },
      release: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);

export const MonitorVital = mongoose.model(
  'MonitorVital',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      name: { type: String, enum: ['lcp', 'inp', 'cls', 'ttfb'], required: true },
      value: { type: Number, required: true },
      release: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);

export const MonitorCustomEvent = mongoose.model(
  'MonitorCustomEvent',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      name: { type: String, required: true },
      props: { type: Schema.Types.Mixed },
      release: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);

export const MonitorRelease = mongoose.model(
  'MonitorRelease',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId, required: true },
      appId: { type: Schema.Types.ObjectId, required: true, index: true },
      version: { type: String, required: true },
      firstSeen: { type: Date, default: Date.now },
    },
    { timestamps: true }
  ).index({ appId: 1, version: 1 }, { unique: true })
);

export const MonitorUptimeCheck = mongoose.model(
  'MonitorUptimeCheck',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      environmentId: { type: Schema.Types.ObjectId },
      appId: { type: Schema.Types.ObjectId },
      name: { type: String, required: true },
      url: { type: String, required: true },
      method: { type: String, default: 'GET' },
      expectedStatus: { type: Number, default: 200 },
      intervalMinutes: { type: Number, default: 5 },
      enabled: { type: Boolean, default: true },
      nextRunAt: { type: Date, default: Date.now, index: true },
    },
    { timestamps: true }
  )
);

export const MONITOR_ALERT_TRIGGERS = [
  'error_new',
  'error_spike',
  'log_level',
  'http_status',
  'transaction_slow',
  'vital_threshold',
  'uptime_down',
  'event_name',
  'new_release',
] as const;

export type MonitorAlertTrigger = (typeof MONITOR_ALERT_TRIGGERS)[number];

export interface IMonitorAlertRule extends Document {
  taskflowOrganizationId: mongoose.Types.ObjectId;
  projectId: mongoose.Types.ObjectId;
  name: string;
  enabled: boolean;
  trigger: MonitorAlertTrigger;
  environmentId?: mongoose.Types.ObjectId;
  appId?: mongoose.Types.ObjectId;
  recipients: string[];
  cooldownMinutes: number;
  lastFiredAt?: Date;
  lastError?: string;
  fireCount: number;
  subjectTemplate: string;
  bodyTemplate: string;
  conditions: {
    logLevels?: string[];
    messageContains?: string;
    minCount?: number;
    windowMinutes?: number;
    httpStatusMin?: number;
    httpStatusMax?: number;
    durationMs?: number;
    vitalName?: string;
    vitalGte?: number;
    eventName?: string;
    uptimeFailStreak?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const alertRuleSchema = new Schema<IMonitorAlertRule>(
  {
    ...orgIdx,
    projectId: { type: Schema.Types.ObjectId, ref: 'MonitorProject', required: true, index: true },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    trigger: { type: String, enum: MONITOR_ALERT_TRIGGERS, required: true },
    environmentId: { type: Schema.Types.ObjectId, ref: 'MonitorEnvironment' },
    appId: { type: Schema.Types.ObjectId, ref: 'MonitorApp' },
    recipients: { type: [String], default: [] },
    cooldownMinutes: { type: Number, default: 15 },
    lastFiredAt: { type: Date },
    lastError: { type: String },
    fireCount: { type: Number, default: 0 },
    subjectTemplate: { type: String, default: '[Monitor] {{project}} · {{trigger}}' },
    bodyTemplate: { type: String, default: '' },
    conditions: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
alertRuleSchema.index({ projectId: 1, enabled: 1, trigger: 1 });
export const MonitorAlertRule = mongoose.model<IMonitorAlertRule>('MonitorAlertRule', alertRuleSchema);

export const MonitorAlertDelivery = mongoose.model(
  'MonitorAlertDelivery',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      ruleId: { type: Schema.Types.ObjectId, required: true, index: true },
      trigger: { type: String },
      subject: { type: String },
      recipients: { type: [String], default: [] },
      summary: { type: String },
      ok: { type: Boolean, default: true },
      error: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 })
);

export const MonitorUptimeSample = mongoose.model(
  'MonitorUptimeSample',
  new Schema(
    {
      ...orgIdx,
      projectId: { type: Schema.Types.ObjectId, required: true, index: true },
      checkId: { type: Schema.Types.ObjectId, required: true, index: true },
      ok: { type: Boolean, required: true },
      status: { type: Number },
      latencyMs: { type: Number },
      error: { type: String },
      timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
  ).index({ timestamp: 1 }, { expireAfterSeconds: ttl14 })
);
