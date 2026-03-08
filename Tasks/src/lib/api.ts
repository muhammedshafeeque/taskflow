const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
export const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:5000';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<ApiResponse<T>> {
  const { token, ...init } = options;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    return {
      success: false,
      message: (json as ApiResponse).message || res.statusText || 'Request failed',
    };
  }
  return json as ApiResponse<T>;
}

export const api = {
  get: <T>(path: string, token?: string) =>
    request<T>(path, { method: 'GET', token }),

  post: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), token }),

  patch: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body), token }),

  put: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body), token }),

  delete: <T>(path: string, token?: string) =>
    request<T>(path, { method: 'DELETE', token }),

  deleteWithBody: <T>(path: string, body: unknown, token?: string) =>
    request<T>(path, { method: 'DELETE', body: JSON.stringify(body), token }),
};

export async function uploadFile(file: File, token?: string): Promise<ApiResponse<{ url: string; originalName: string; mimeType: string; size: number }>> {
  const formData = new FormData();
  formData.append('file', file);

  const headers: HeadersInit = {};
  if (token) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    body: formData,
    headers,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    return {
      success: false,
      message: (json as ApiResponse).message || res.statusText || 'Upload failed',
    };
  }
  return json as ApiResponse<{ url: string; originalName: string; mimeType: string; size: number }>;
}

/* Auth */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: string;
  roleId?: string;
  roleName?: string;
  designationName?: string;
  permissions: string[];
  mustChangePassword: boolean;
  createdAt?: string;
}

export interface AuthData {
  user: AuthUser;
  tokens: { accessToken: string; refreshToken: string; expiresIn: string };
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthData>('/auth/login', { email, password }),

  refresh: (refreshToken: string) =>
    api.post<AuthData>('/auth/refresh', { refreshToken }),

  updateProfile: (data: { name?: string; avatarUrl?: string }, token: string) =>
    api.patch<{ user: AuthUser }>('/auth/me', data, token),

  changePassword: (currentPassword: string, newPassword: string, token: string) =>
    api.patch<{ user: AuthUser }>('/auth/me/password', { currentPassword, newPassword }, token),

  forgotPassword: (email: string) =>
    api.post<{ message?: string }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    api.post<AuthData>('/auth/reset-password', { token, newPassword }),
};

/* Projects */
export interface ProjectStatus {
  id: string;
  name: string;
  order: number;
  icon?: string;
  color?: string;
}

export interface ProjectIssueType {
  id: string;
  name: string;
  order: number;
  icon?: string;
  color?: string;
}

export interface ProjectPriority {
  id: string;
  name: string;
  order: number;
  icon?: string;
  color?: string;
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'user';

export interface ProjectCustomField {
  id: string;
  key: string;
  label: string;
  fieldType: CustomFieldType;
  required: boolean;
  options?: string[];
  order: number;
}

export type ProjectVersionStatus = 'unreleased' | 'released' | 'archived';

export interface ProjectVersion {
  id: string;
  name: string;
  description?: string;
  releaseDate?: string; // ISO date
  status: ProjectVersionStatus;
  order: number;
  /** Environment ids this version is mapped to */
  mappedEnvironmentIds?: string[];
  releasedAtByEnvironment?: Record<string, string>;
  releaseNotesByEnvironment?: Record<string, string>;
  /** Number of issues with fixVersion set to this version (set by API when loading project) */
  issueCount?: number;
}

export interface ProjectEnvironment {
  id: string;
  name: string;
  order: number;
}

export interface ProjectReleaseRule {
  environmentId: string;
  statusName: string;
  assigneeId?: string;
  notifyUserIds?: string[];
  notifyChannels?: ('email' | 'in_app' | 'third_party')[];
}

export interface Project {
  _id: string;
  name: string;
  key: string;
  description?: string;
  lead?: { _id: string; name: string; email: string };
  statuses?: ProjectStatus[];
  issueTypes?: ProjectIssueType[];
  priorities?: ProjectPriority[];
  customFields?: ProjectCustomField[];
  versions?: ProjectVersion[];
  environments?: ProjectEnvironment[];
  releaseRules?: ProjectReleaseRule[];
  createdAt?: string;
  /** Set on list response: user has project:edit in this project */
  canEdit?: boolean;
  /** Set on list response: user has project:delete in this project */
  canDelete?: boolean;
}

export interface ProjectMember {
  _id: string;
  project: string;
  user: { _id: string; name: string; email: string };
  role: { _id: string; name: string };
}

export interface ProjectInvitation {
  _id: string;
  project: string;
  user: { _id: string; name: string; email: string };
  invitedBy: { _id: string; name: string };
  status: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const projectsApi = {
  list: (page = 1, limit = 20, token: string) =>
    api.get<Paginated<Project>>(`/projects?page=${page}&limit=${limit}`, token),
  get: (id: string, token: string) => api.get<Project>(`/projects/${id}`, token),
  getMyPermissions: (projectId: string, token: string) =>
    api.get<{ permissions: string[] }>(`/projects/${projectId}/my-permissions`, token),
  create: (body: { name: string; key: string; description?: string; lead: string; templateId?: string }, token: string) =>
    api.post<Project>('/projects', body, token),
  update: (
    id: string,
    body: Partial<{
      name: string;
      key: string;
      description: string;
      lead: string;
      statuses: ProjectStatus[];
      issueTypes: ProjectIssueType[];
      priorities: ProjectPriority[];
      customFields: ProjectCustomField[];
      versions: ProjectVersion[];
      environments: ProjectEnvironment[];
      releaseRules: ProjectReleaseRule[];
    }>,
    token: string
  ) => api.patch<Project>(`/projects/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/projects/${id}`, token),
  releaseVersion: (projectId: string, versionId: string, environmentId: string, token: string, issueIds?: string[]) =>
    api.post<{ releaseNotes: string; version: ProjectVersion; updatedCount: number }>(
      `/projects/${projectId}/versions/release`,
      { versionId, environmentId, issueIds },
      token
    ),
  getMembers: (projectId: string, token: string) =>
    api.get<ProjectMember[]>(`/projects/${projectId}/members`, token),
  getInvitations: (projectId: string, token: string) =>
    api.get<ProjectInvitation[]>(`/projects/${projectId}/invitations`, token),
  inviteMember: (projectId: string, body: { email: string }, token: string) =>
    api.post<unknown>(`/projects/${projectId}/invite`, body, token),
  cancelInvitation: (projectId: string, invitationId: string, token: string) =>
    api.delete(`/projects/${projectId}/invitations/${invitationId}`, token),
};

export interface ProjectTemplate {
  _id: string;
  name: string;
  description?: string;
  statuses?: Array<{ id: string; name: string; order: number }>;
  issueTypes?: Array<{ id: string; name: string; order: number }>;
  priorities?: Array<{ id: string; name: string; order: number }>;
}

export const projectTemplatesApi = {
  list: (token: string) => api.get<ProjectTemplate[]>('/project-templates', token),
  get: (id: string, token: string) => api.get<ProjectTemplate>(`/project-templates/${id}`, token),
};

export interface Milestone {
  _id: string;
  name: string;
  dueDate?: string;
  status: string;
  description?: string;
}

export const milestonesApi = {
  list: (projectId: string, token: string) =>
    api.get<Milestone[]>(`/projects/${projectId}/milestones`, token),
  create: (projectId: string, body: { name: string; dueDate?: string; status?: string; description?: string }, token: string) =>
    api.post<Milestone>(`/projects/${projectId}/milestones`, body, token),
  update: (projectId: string, milestoneId: string, body: { name?: string; dueDate?: string; status?: string; description?: string }, token: string) =>
    api.patch<Milestone>(`/projects/${projectId}/milestones/${milestoneId}`, body, token),
  delete: (projectId: string, milestoneId: string, token: string) =>
    api.delete(`/projects/${projectId}/milestones/${milestoneId}`, token),
};

export interface Roadmap {
  _id: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  milestoneIds?: string[];
}

export const roadmapsApi = {
  list: (projectId: string, token: string) =>
    api.get<Roadmap[]>(`/projects/${projectId}/roadmaps`, token),
  create: (projectId: string, body: { name: string; description?: string; startDate?: string; endDate?: string; milestoneIds?: string[] }, token: string) =>
    api.post<Roadmap>(`/projects/${projectId}/roadmaps`, body, token),
  update: (projectId: string, roadmapId: string, body: { name?: string; description?: string; startDate?: string; endDate?: string; milestoneIds?: string[] }, token: string) =>
    api.patch<Roadmap>(`/projects/${projectId}/roadmaps/${roadmapId}`, body, token),
  delete: (projectId: string, roadmapId: string, token: string) =>
    api.delete(`/projects/${projectId}/roadmaps/${roadmapId}`, token),
  getMilestones: (projectId: string, roadmapId: string, token: string) =>
    api.get<Milestone[]>(`/projects/${projectId}/roadmaps/${roadmapId}/milestones`, token),
};

export interface TestCase {
  _id: string;
  title: string;
  steps?: string;
  expectedResult?: string;
  status: string;
  priority: string;
  type: string;
  linkedIssueId?: { _id: string; key: string; title: string };
}

export interface TraceabilityRow {
  issueId: string;
  issueKey: string;
  issueTitle: string;
  linkedTestCases: Array<{ testCaseId: string; title: string; status: string; latestResult?: string }>;
}

export const traceabilityApi = {
  get: (projectId: string, token: string) =>
    api.get<TraceabilityRow[]>(`/projects/${projectId}/traceability`, token),
};

export const testCasesApi = {
  list: (projectId: string, token: string) =>
    api.get<TestCase[]>(`/projects/${projectId}/test-cases`, token),
  create: (projectId: string, body: { title: string; steps?: string; expectedResult?: string; status?: string; priority?: string; type?: string; linkedIssueId?: string }, token: string) =>
    api.post<TestCase>(`/projects/${projectId}/test-cases`, body, token),
  update: (projectId: string, testCaseId: string, body: Partial<TestCase>, token: string) =>
    api.patch<TestCase>(`/projects/${projectId}/test-cases/${testCaseId}`, body, token),
  delete: (projectId: string, testCaseId: string, token: string) =>
    api.delete(`/projects/${projectId}/test-cases/${testCaseId}`, token),
};

export interface TestPlan {
  _id: string;
  project: string;
  name: string;
  description?: string;
  testCaseIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TestCycle {
  _id: string;
  testPlan: string;
  name: string;
  startDate?: string;
  endDate?: string;
  status: 'draft' | 'in_progress' | 'completed';
  createdAt: string;
  updatedAt: string;
}

export type TestRunStatus = 'pending' | 'pass' | 'fail' | 'blocked' | 'skip';

export interface CycleRunItem {
  testCase: TestCase;
  run: { status: TestRunStatus; result?: string; executedAt?: string; assignee?: { name: string; email: string } };
}

export const testPlansApi = {
  list: (projectId: string, token: string) =>
    api.get<TestPlan[]>(`/projects/${projectId}/test-plans`, token),
  create: (projectId: string, body: { name: string; description?: string; testCaseIds?: string[] }, token: string) =>
    api.post<TestPlan>(`/projects/${projectId}/test-plans`, body, token),
  update: (projectId: string, planId: string, body: Partial<{ name: string; description: string; testCaseIds: string[] }>, token: string) =>
    api.patch<TestPlan>(`/projects/${projectId}/test-plans/${planId}`, body, token),
  delete: (projectId: string, planId: string, token: string) =>
    api.delete(`/projects/${projectId}/test-plans/${planId}`, token),
  listCycles: (projectId: string, planId: string, token: string) =>
    api.get<TestCycle[]>(`/projects/${projectId}/test-plans/${planId}/cycles`, token),
  createCycle: (projectId: string, planId: string, body: { name: string; startDate?: string; endDate?: string; status?: string }, token: string) =>
    api.post<TestCycle>(`/projects/${projectId}/test-plans/${planId}/cycles`, body, token),
  updateCycle: (projectId: string, planId: string, cycleId: string, body: Partial<{ name: string; startDate: string; endDate: string; status: string }>, token: string) =>
    api.patch<TestCycle>(`/projects/${projectId}/test-plans/${planId}/cycles/${cycleId}`, body, token),
  deleteCycle: (projectId: string, planId: string, cycleId: string, token: string) =>
    api.delete(`/projects/${projectId}/test-plans/${planId}/cycles/${cycleId}`, token),
  getCycleRuns: (projectId: string, planId: string, cycleId: string, token: string) =>
    api.get<CycleRunItem[]>(`/projects/${projectId}/test-plans/${planId}/cycles/${cycleId}/runs`, token),
  updateRunStatus: (projectId: string, planId: string, cycleId: string, testCaseId: string, body: { status: TestRunStatus; result?: string; assignee?: string }, token: string) =>
    api.patch(`/projects/${projectId}/test-plans/${planId}/cycles/${cycleId}/runs/${testCaseId}`, body, token),
};

export type ReportType = 'issues_by_status' | 'issues_by_assignee' | 'workload' | 'defects';

export interface Report {
  _id: string;
  user: string;
  project?: { _id: string; name: string; key: string };
  name: string;
  type: ReportType;
  config?: { filters?: Record<string, unknown>; groupBy?: string; chartType?: 'bar' | 'pie' | 'table' };
  createdAt: string;
  updatedAt: string;
}

export interface ReportExecuteResult {
  type: string;
  data?: Record<string, unknown>;
  labels?: string[];
  values?: number[];
  byStatus?: { labels: string[]; values: number[] };
  byPriority?: { labels: string[]; values: number[] };
}

export const reportsApi = {
  list: (token: string) => api.get<Report[]>(`/reports`, token),
  create: (body: { name: string; project?: string; type: ReportType; config?: Report['config'] }, token: string) =>
    api.post<Report>('/reports', body, token),
  update: (id: string, body: Partial<{ name: string; project: string | null; type: ReportType; config: Report['config'] }>, token: string) =>
    api.patch<Report>(`/reports/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/reports/${id}`, token),
  execute: (id: string, token: string) => api.post<ReportExecuteResult>(`/reports/${id}/execute`, {}, token),
};

/* Saved Filters */
export interface SavedFilterData {
  _id: string;
  name: string;
  filters: {
    status: string[];
    assignee: string[];
    reporter: string[];
    type: string[];
    priority: string[];
    labels: string[];
    storyPoints: string[];
    hasStoryPoints?: boolean;
  };
  quickFilter: 'all' | 'my' | 'open';
  jql?: string;
  viewMode?: 'list' | 'table' | 'kanban';
  createdAt: string;
}

export const savedFiltersApi = {
  list: (projectId: string, token: string) =>
    api.get<SavedFilterData[]>(`/saved-filters?${new URLSearchParams({ project: projectId })}`, token),
  create: (
    body: {
      project: string;
      name: string;
      filters: SavedFilterData['filters'];
      quickFilter: 'all' | 'my' | 'open';
      jql?: string;
      viewMode?: 'list' | 'table' | 'kanban';
    },
    token: string
  ) => api.post<SavedFilterData>('/saved-filters', body, token),
  update: (
    id: string,
    body: Partial<{
      name: string;
      filters: SavedFilterData['filters'];
      quickFilter: 'all' | 'my' | 'open';
      jql: string | null;
      viewMode: 'list' | 'table' | 'kanban' | null;
    }>,
    token: string
  ) => api.patch<SavedFilterData>(`/saved-filters/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/saved-filters/${id}`, token),
};

/* Dashboard */
export interface DashboardStats {
  totalIssues: number;
  issuesByStatus: Record<string, number>;
  recentIssues: Array<{
    _id: string;
    key?: string;
    title: string;
    status: string;
    project: string;
    projectName?: string;
    updatedAt: string;
  }>;
}

export interface WorkloadEntry {
  userId: string;
  userName: string;
  totalCount: number;
  openCount: number;
  doneCount: number;
  storyPoints: number;
}

export interface AuditLogEntry {
  _id: string;
  user?: { _id: string; name: string; email: string };
  action: string;
  resourceType: string;
  resourceId?: string;
  projectId?: { _id: string; name: string; key: string };
  meta?: Record<string, unknown>;
  ip?: string;
  createdAt: string;
}

export const auditLogsApi = {
  list: (params: { page?: number; limit?: number; user?: string; action?: string; resourceType?: string; projectId?: string }, token: string) => {
    const q = new URLSearchParams();
    if (params.page) q.set('page', String(params.page));
    if (params.limit) q.set('limit', String(params.limit));
    if (params.user) q.set('user', params.user);
    if (params.action) q.set('action', params.action);
    if (params.resourceType) q.set('resourceType', params.resourceType);
    if (params.projectId) q.set('projectId', params.projectId);
    return api.get<{ data: AuditLogEntry[]; total: number; page: number; limit: number; totalPages: number }>(`/audit-logs?${q.toString()}`, token);
  },
};

export const dashboardApi = {
  getStats: (token: string) => api.get<DashboardStats>('/dashboard/stats', token),
  getPortfolio: (token: string) =>
    api.get<Array<{ projectId: string; projectName: string; projectKey: string; totalIssues: number; doneCount: number; openCount: number; progressPercent: number }>>('/dashboard/portfolio', token),
  getExecutive: (token: string) =>
    api.get<DashboardStats & { totalProjects: number }>('/dashboard/executive', token),
  getDefectMetrics: (token: string, projectId?: string) =>
    api.get<{ totalBugs: number; openBugs: number; closedBugs: number; byStatus: Record<string, number>; byPriority: Record<string, number>; defectDensity?: number }>(
      projectId ? `/dashboard/defect-metrics?projectId=${projectId}` : '/dashboard/defect-metrics',
      token
    ),
  getCostUsage: (token: string, projectId?: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api.get<{ entries: Array<{ projectId: string; projectName: string; userId: string; userName: string; totalMinutes: number; totalHours: number }> }>(
      `/dashboard/cost-usage?${params}`,
      token
    );
  },
  getWorkload: (token: string, projectId?: string) =>
    api.get<{ entries: WorkloadEntry[] }>(
      projectId ? `/dashboard/workload?projectId=${encodeURIComponent(projectId)}` : '/dashboard/workload',
      token
    ),
  getEstimates: (token: string, projectId?: string) =>
    api.get<EstimatesResponse>(
      projectId ? `/dashboard/estimates?projectId=${encodeURIComponent(projectId)}` : '/dashboard/estimates',
      token
    ),
};

export interface EstimatesResponse {
  totalMinutes: number;
  byProject: Array<{ projectId: string; projectName: string; totalMinutes: number }>;
  byAssignee: Array<{ userId: string; userName: string; totalMinutes: number }>;
  remainingEstimateMinutes?: number;
  loggedMinutesOnDone?: number;
  burnRatePerDay?: number;
  expectedDeliveryDate?: string | null;
  unestimatedIssuesCount?: number;
}

/* Users */
export interface User {
  _id: string;
  name: string;
  email: string;
  role?: string;
  roleId?: { _id: string; name: string };
  designation?: { _id: string; name: string };
  projectCount?: number;
  createdAt?: string;
  enabled?: boolean;
}

export interface InviteUserBody {
  name: string;
  email: string;
  designationId?: string;
  roleId: string;
}

export interface UpdateUserBody {
  name?: string;
  roleId?: string | null;
  designationId?: string | null;
  enabled?: boolean;
}

export const usersApi = {
  list: (page = 1, limit = 100, token: string) =>
    api.get<Paginated<User>>(`/users?page=${page}&limit=${limit}`, token),
  get: (id: string, token: string) => api.get<User>(`/users/${id}`, token),
  update: (id: string, body: UpdateUserBody, token: string) =>
    api.patch<User>(`/users/${id}`, body, token),
  invite: (body: InviteUserBody, token: string) =>
    api.post<User>('/users/invite', body, token),
};

/* Permissions (predefined list for role editor) */
export interface PermissionItem {
  code: string;
  label: string;
}

export const permissionsApi = {
  list: (token?: string) => api.get<PermissionItem[]>('/roles/permissions', token),
};

export interface LicenseData {
  userCount: number;
  maxUsers: number | null;
  plan?: string;
}

export const adminApi = {
  getLicense: (token: string) => api.get<LicenseData>('/admin/license', token),
};

/* Roles */
export interface Role {
  _id: string;
  name: string;
  permissions: string[];
}

export const rolesApi = {
  list: (token: string) => api.get<Role[]>('/roles', token),
  get: (id: string, token: string) => api.get<Role>(`/roles/${id}`, token),
  create: (body: { name: string; permissions: string[] }, token: string) =>
    api.post<Role>('/roles', body, token),
  update: (id: string, body: { name?: string; permissions?: string[] }, token: string) =>
    api.patch<Role>(`/roles/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/roles/${id}`, token),
};

/* Designations */
export interface Designation {
  _id: string;
  name: string;
  slug?: string;
  order?: number;
}

export const designationsApi = {
  list: (token: string) => api.get<Designation[]>('/designations', token),
  get: (id: string, token: string) => api.get<Designation>(`/designations/${id}`, token),
  create: (body: { name: string; slug?: string; order?: number }, token: string) =>
    api.post<Designation>('/designations', body, token),
  update: (id: string, body: { name?: string; slug?: string; order?: number }, token: string) =>
    api.patch<Designation>(`/designations/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/designations/${id}`, token),
};

/* Inbox */
export interface InboxMessage {
  _id: string;
  toUser: string;
  type: string;
  title: string;
  body?: string;
  readAt?: string;
  createdAt: string;
  meta?: { invitationId?: string; status?: string };
}

export const inboxApi = {
  list: (page = 1, limit = 50, token: string) =>
    api.get<Paginated<InboxMessage>>(`/inbox?page=${page}&limit=${limit}`, token),
  markRead: (id: string, token: string) => api.patch<InboxMessage>(`/inbox/${id}/read`, {}, token),
};

/* Invitations (accept / decline project invites) */
export const invitationsApi = {
  accept: (invitationId: string, token: string) =>
    api.post<{ projectId: string }>(`/invitations/${invitationId}/accept`, {}, token),
  decline: (invitationId: string, token: string) =>
    api.post(`/invitations/${invitationId}/decline`, {}, token),
};

/* Push subscriptions (browser push for project invites) */
export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export const pushApi = {
  getVapidPublicKey: (token?: string) =>
    api.get<{ vapidPublicKey: string }>('/push/vapid-public-key', token),
  subscribe: (subscription: PushSubscriptionJSON, token: string) =>
    api.post('/push-subscriptions', { subscription }, token),
  unsubscribe: (endpoint: string, token: string) =>
    api.deleteWithBody('/push-subscriptions', { endpoint }, token),
};

/* Issues */
export type IssueType = 'Bug' | 'Story' | 'Task' | 'Epic'; // legacy defaults
export type IssuePriority = string; // project-configured (e.g. Lowest, Low, Medium, High, Highest)
export type IssueStatus = 'Todo' | 'In Progress' | 'Done' | 'Backlog'; // legacy defaults

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Issue {
  _id: string;
  key?: string;
  title: string;
  description?: string;
  type: string;
  priority: IssuePriority;
  status: string;
  assignee?: { _id: string; name: string; email: string };
  reporter?: { _id: string; name: string; email: string };
  project?: { _id: string; name: string; key: string };
  sprint?: { _id: string; name: string; status: string };
  parent?: { _id: string; key: string; title: string };
  milestone?: { _id: string; name: string; dueDate?: string; status: string };
  boardColumn?: string;
  labels?: string[];
  dueDate?: string;
  startDate?: string;
  storyPoints?: number;
  timeEstimateMinutes?: number;
  checklist?: ChecklistItem[];
  customFieldValues?: Record<string, unknown>;
  fixVersion?: string;
  affectsVersions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** Ticket ID: <projectKey>-<number> e.g. S20-686 */
export function getIssueKey(issue: Issue): string {
  return (
    issue.key ??
    (issue.project ? `${issue.project.key}-${issue._id.slice(-6)}` : issue._id.slice(-8))
  );
}

export const issuesApi = {
  list: (params: Record<string, string | number> & { token: string }) => {
    const { token, ...p } = params;
    const q = new URLSearchParams(p as Record<string, string>).toString();
    return api.get<Paginated<Issue>>(`/issues?${q}`, token);
  },
  get: (id: string, token: string) => api.get<Issue>(`/issues/${id}`, token),
  getByKey: (projectId: string, key: string, token: string) =>
    api.get<Issue>(`/issues/by-key?${new URLSearchParams({ project: projectId, key })}`, token),
  search: (projectId: string, q: string, page: number, limit: number, token: string) =>
    api.get<Paginated<Issue>>(
      `/issues/search?${new URLSearchParams({ project: projectId, q, page: String(page), limit: String(limit) })}`,
      token
    ),
  searchJql: (jql: string, page: number, limit: number, token: string) =>
    api.get<Paginated<Issue>>(
      `/issues/jql?${new URLSearchParams({ jql, page: String(page), limit: String(limit) })}`,
      token
    ),
  create: (
    body: {
      title: string;
      project: string;
      description?: string;
      type?: string;
      priority?: IssuePriority;
      status?: string;
      assignee?: string;
      parent?: string;
      milestone?: string;
      customFieldValues?: Record<string, unknown>;
      fixVersion?: string;
      affectsVersions?: string[];
    },
    token: string
  ) => api.post<Issue>('/issues', body, token),
  update: (
    id: string,
    body: Partial<Omit<Issue, 'assignee' | 'project' | 'reporter' | 'parent' | 'sprint' | 'milestone'>> & {
      assignee?: string;
      dueDate?: string | null;
      startDate?: string | null;
      storyPoints?: number | null;
      timeEstimateMinutes?: number | null;
      parent?: string | null;
      sprint?: string | null;
      milestone?: string | null;
      checklist?: ChecklistItem[];
      customFieldValues?: Record<string, unknown>;
      fixVersion?: string | null;
      affectsVersions?: string[];
    },
    token: string
  ) => api.patch<Issue>(`/issues/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/issues/${id}`, token),
  getHistory: (issueId: string, page = 1, limit = 50, token: string) =>
    api.get<Paginated<IssueHistoryItem>>(
      `/issues/${issueId}/history?page=${page}&limit=${limit}`,
      token
    ),
  getSubtasks: (issueId: string, token: string) =>
    api.get<Issue[]>(`/issues/${issueId}/subtasks`, token),
  getLinks: (issueId: string, token: string) =>
    api.get<IssueLink[]>(`/issues/${issueId}/links`, token),
  addLink: (issueId: string, data: { targetIssueId: string; linkType: string }, token: string) =>
    api.post<unknown>(`/issues/${issueId}/links`, data, token),
  removeLink: (issueId: string, linkId: string, token: string) =>
    api.delete(`/issues/${issueId}/links/${linkId}`, token),
  searchGlobal: (q: string, page: number, limit: number, token: string, excludeIssueId?: string) =>
    api.get<Paginated<Issue>>(
      `/issues/search-global?${new URLSearchParams({
        q,
        page: String(page),
        limit: String(limit),
        ...(excludeIssueId ? { excludeIssueId } : {}),
      })}`,
      token
    ),
  bulkUpdate: (
    issueIds: string[],
    updates: { status?: string; assignee?: string | null; sprint?: string | null; labels?: string[]; type?: string; priority?: string; fixVersion?: string | null },
    token: string
  ) => api.patch<{ updated: number; errors: string[] }>('/issues/bulk', { issueIds, updates }, token),
  bulkDelete: (issueIds: string[], token: string) =>
    api.deleteWithBody<{ deleted: number; errors: string[] }>('/issues/bulk', { issueIds }, token),
  updateBacklogOrder: (issueIds: string[], token: string) =>
    api.put<{ updated: number }>('/issues/backlog-order', { issueIds }, token),
  watch: (issueId: string, token: string) => api.post(`/issues/${issueId}/watch`, {}, token),
  unwatch: (issueId: string, token: string) => api.delete(`/issues/${issueId}/watch`, token),
  getWatchers: (issueId: string, token: string) =>
    api.get<{ user: { _id: string; name: string; email: string } }[]>(`/issues/${issueId}/watchers`, token),
  getWatchingStatus: (issueId: string, token: string) =>
    api.get<{ watching: boolean }>(`/issues/${issueId}/watching`, token),
  getWatchingStatusBatch: (issueIds: string[], token: string) => {
    if (issueIds.length === 0) return Promise.resolve({ success: true, data: {} as Record<string, boolean> });
    const ids = issueIds.slice(0, 100).join(',');
    return api.get<Record<string, boolean>>(`/issues/watching-status?ids=${encodeURIComponent(ids)}`, token);
  },
  downloadExcel: async (
    params: Record<string, string>,
    token: string
  ): Promise<{ success: boolean; message?: string }> => {
    const q = new URLSearchParams(params).toString();
    const headers: HeadersInit = {};
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}/issues/export?${q}`, { method: 'GET', headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { success: false, message: (json as ApiResponse).message || res.statusText };
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition');
    const filename =
      disposition?.match(/filename="(.+)"/)?.[1] ?? `issues_${params.project ?? 'export'}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  },
};

export type IssueLinkType = 'blocks' | 'is_blocked_by' | 'duplicates' | 'is_duplicated_by' | 'relates_to';

export interface IssueLink {
  _id: string;
  linkType: IssueLinkType;
  direction: 'outbound' | 'inbound';
  issue: { _id: string; key: string; title: string; project?: { _id: string; name: string; key: string } };
}

export interface IssueHistoryItem {
  _id: string;
  action: 'created' | 'field_change' | 'comment_added' | 'comment_updated';
  author: { _id: string; name: string };
  createdAt: string;
  field?: string;
  fromValue?: string;
  toValue?: string;
  commentId?: string;
  commentBody?: string;
}

/* Comments */
export interface Comment {
  _id: string;
  body: string;
  issue: string;
  author: { _id: string; name: string; email: string };
  createdAt: string;
}

export const commentsApi = {
  list: (issueId: string, page = 1, limit = 20, token: string) =>
    api.get<Paginated<Comment>>(`/issues/${issueId}/comments?page=${page}&limit=${limit}`, token),
  create: (issueId: string, body: string, token: string) =>
    api.post<Comment>(`/issues/${issueId}/comments`, { body }, token),
  update: (issueId: string, commentId: string, body: string, token: string) =>
    api.patch<Comment>(`/issues/${issueId}/comments/${commentId}`, { body }, token),
  delete: (issueId: string, commentId: string, token: string) =>
    api.delete(`/issues/${issueId}/comments/${commentId}`, token),
};

/* Attachments */
export interface Attachment {
  _id: string;
  issue: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadedBy: { _id: string; name: string };
  createdAt: string;
}

export const attachmentsApi = {
  list: (issueId: string, token: string) =>
    api.get<Attachment[]>(`/issues/${issueId}/attachments`, token),
  add: (
    issueId: string,
    data: { url: string; originalName: string; mimeType: string; size: number },
    token: string
  ) => api.post<Attachment>(`/issues/${issueId}/attachments`, data, token),
  remove: (issueId: string, attachmentId: string, token: string) =>
    api.delete(`/issues/${issueId}/attachments/${attachmentId}`, token),
};

/* Work logs / Timesheet */
export interface WorkLog {
  _id: string;
  issue: string;
  author: { _id: string; name: string; email: string };
  minutesSpent: number;
  date: string;
  description?: string;
  createdAt: string;
}

export interface TimesheetUserRow {
  userId: string;
  userName: string;
  byDate: Record<string, number>;
  total: number;
}

export interface TimesheetResult {
  byUser: TimesheetUserRow[];
  byDate: Record<string, number>;
  dateRange: { start: string; end: string };
}

export const workLogsApi = {
  list: (issueId: string, page = 1, limit = 20, token: string) =>
    api.get<Paginated<WorkLog>>(
      `/issues/${issueId}/work-logs?page=${page}&limit=${limit}`,
      token
    ),
  create: (
    issueId: string,
    body: { minutesSpent: number; date: string; description?: string },
    token: string
  ) => api.post<WorkLog>(`/issues/${issueId}/work-logs`, body, token),
  update: (
    issueId: string,
    workLogId: string,
    body: Partial<{ minutesSpent: number; date: string; description?: string }>,
    token: string
  ) => api.patch<WorkLog>(`/issues/${issueId}/work-logs/${workLogId}`, body, token),
  delete: (issueId: string, workLogId: string, token: string) =>
    api.delete(`/issues/${issueId}/work-logs/${workLogId}`, token),
};

export interface TimesheetDetailItem {
  _id: string;
  issueId: string;
  issueKey: string;
  issueTitle: string;
  projectName: string;
  projectId: string;
  minutesSpent: number;
  date: string;
  description?: string;
  authorId: string;
  authorName: string;
  createdAt: string;
}

export const timesheetApi = {
  /** Global timesheet across all projects the user is a member of. */
  getGlobal: (startDate: string, endDate: string, token: string) => {
    const q = new URLSearchParams({ startDate, endDate }).toString();
    return api.get<TimesheetResult>(`/timesheet?${q}`, token);
  },
  /** Work logs for a specific user and date. */
  getDetails: (userId: string, date: string, token: string) => {
    const q = new URLSearchParams({ userId, date }).toString();
    return api.get<TimesheetDetailItem[]>(`/timesheet/details?${q}`, token);
  },
  /** Download detailed timesheet as Excel file. */
  downloadExcel: async (startDate: string, endDate: string, token: string): Promise<{ success: boolean; message?: string }> => {
    const q = new URLSearchParams({ startDate, endDate }).toString();
    const headers: HeadersInit = {};
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}/timesheet/export?${q}`, { method: 'GET', headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { success: false, message: (json as ApiResponse).message || res.statusText };
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition');
    const filename = disposition?.match(/filename="(.+)"/)?.[1] ?? `timesheet_${startDate}_to_${endDate}.xlsx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  },
};

/* Boards */
export interface BoardColumn {
  name: string;
  statusId: string;
  order: number;
}

export interface Board {
  _id: string;
  name: string;
  type: 'Kanban' | 'Scrum';
  project: { _id: string; name: string; key: string };
  columns: BoardColumn[];
}

export const boardsApi = {
  list: (page = 1, limit = 20, projectId: string | undefined, token: string) => {
    const q = projectId ? `page=${page}&limit=${limit}&project=${projectId}` : `page=${page}&limit=${limit}`;
    return api.get<Paginated<Board>>(`/boards?${q}`, token);
  },
  get: (id: string, token: string) => api.get<Board>(`/boards/${id}`, token),
  create: (body: { name: string; type: 'Kanban' | 'Scrum'; project: string; columns?: BoardColumn[] }, token: string) =>
    api.post<Board>('/boards', body, token),
  update: (id: string, body: Partial<Board>, token: string) =>
    api.patch<Board>(`/boards/${id}`, body, token),
  delete: (id: string, token: string) => api.delete(`/boards/${id}`, token),
};

/* Sprints */
export interface Sprint {
  _id: string;
  name: string;
  project: { _id: string; name: string; key: string };
  board: { _id: string; name: string; type: string };
  startDate?: string;
  endDate?: string;
  status: 'planned' | 'active' | 'completed';
}

export const sprintsApi = {
  list: (
    page = 1,
    limit = 20,
    projectId: string | undefined,
    boardId: string | undefined,
    token: string,
    status?: string
  ) => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (projectId) p.set('project', projectId);
    if (boardId) p.set('board', boardId);
    if (status) p.set('status', status);
    return api.get<Paginated<Sprint>>(`/sprints?${p}`, token);
  },
  get: (id: string, token: string) => api.get<Sprint>(`/sprints/${id}`, token),
  create: (body: { name: string; project: string; board: string }, token: string) =>
    api.post<Sprint>('/sprints', body, token),
  start: (id: string, token: string) => api.post<Sprint>(`/sprints/${id}/start`, {}, token),
  complete: (id: string, token: string) => api.post<Sprint>(`/sprints/${id}/complete`, {}, token),
  delete: (id: string, token: string) => api.delete(`/sprints/${id}`, token),
  getReport: (projectId: string, sprintId: string, token: string) =>
    api.get<{
      burndown: { date: string; ideal: number; actual: number }[];
      velocity: { sprintName: string; completedSP: number }[];
      summary: {
        totalIssues: number;
        completedIssues: number;
        remainingIssues: number;
        storyPointsCommitted: number;
        storyPointsCompleted: number;
        storyPointsRemaining: number;
      };
    }>(`/projects/${projectId}/sprints/${sprintId}/report`, token),
  getCompletionPreview: (sprintId: string, projectId: string, token: string) =>
    api.get<{ incompleteCount: number; incompleteIssues: { _id: string; key?: string; title: string }[] }>(
      `/sprints/${sprintId}/completion-preview?project=${projectId}`,
      token
    ),
};
