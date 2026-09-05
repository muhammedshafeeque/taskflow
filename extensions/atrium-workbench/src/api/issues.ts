import type { AtriumClient } from './client';

export interface IssueRef {
  _id: string;
  key?: string;
  title: string;
  description?: string;
  status: string;
  type?: string;
  priority?: string;
  assignee?: { _id: string; name?: string; email?: string };
  reporter?: { _id: string; name?: string; email?: string };
  project?: { _id: string; name?: string; key?: string; statuses?: Array<{ name: string; isClosed?: boolean }> };
  labels?: string[];
  updatedAt?: string;
  createdAt?: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface Comment {
  _id: string;
  body: string;
  author?: { _id: string; name?: string; email?: string };
  createdAt?: string;
}

export interface ProjectDetail {
  _id: string;
  name: string;
  key?: string;
  statuses?: Array<{ name: string; isClosed?: boolean; order?: number }>;
}

export function listMyIssues(
  client: AtriumClient,
  userId: string,
  opts?: { projectId?: string }
) {
  const params = new URLSearchParams({
    assignee: userId,
    page: '1',
    limit: '50',
  });
  if (opts?.projectId) params.set('project', opts.projectId);
  return client.get<Paginated<IssueRef>>(`/issues?${params.toString()}`);
}

export function listProjects(client: AtriumClient) {
  return client.get<Paginated<ProjectDetail>>('/projects?page=1&limit=100');
}

export function getIssue(client: AtriumClient, id: string) {
  return client.get<IssueRef>(`/issues/${id}`);
}

export function updateIssue(client: AtriumClient, id: string, body: Record<string, unknown>) {
  return client.patch<IssueRef>(`/issues/${id}`, body);
}

export function listComments(client: AtriumClient, issueId: string) {
  return client.get<Paginated<Comment>>(`/issues/${issueId}/comments?page=1&limit=50`);
}

export function addComment(client: AtriumClient, issueId: string, body: string) {
  return client.post<Comment>(`/issues/${issueId}/comments`, { body });
}

export function getProject(client: AtriumClient, projectId: string) {
  return client.get<ProjectDetail>(`/projects/${projectId}`);
}

export interface IssueAttachment {
  _id: string;
  url: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export function listAttachments(client: AtriumClient, issueId: string) {
  return client.get<IssueAttachment[]>(`/issues/${issueId}/attachments`);
}

export function listOrganizations(client: AtriumClient) {
  return client.get<{ organizations: Array<{ id: string; name: string; slug?: string }> }>('/organizations');
}

export function switchOrganization(client: AtriumClient, id: string) {
  return client.post<{ user: unknown; tokens: { accessToken: string; refreshToken: string } }>(
    `/organizations/${id}/switch`,
    {}
  );
}
