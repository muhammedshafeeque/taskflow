import { api } from './api';

export type DocSpaceRole = 'admin' | 'editor' | 'viewer';
export type DocSpaceAudience = 'workspace' | 'project' | 'restricted';

export interface DocPersonRef {
  id: string;
  name?: string;
  email?: string;
}

export interface DocProjectRef {
  id: string;
  name: string;
  key: string;
}

export interface DocSpace {
  id: string;
  key: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  audience: DocSpaceAudience;
  audienceRole: 'editor' | 'viewer';
  projects: DocProjectRef[];
  members: Array<DocPersonRef & { role: DocSpaceRole }>;
  homePageId: string | null;
  archived: boolean;
  starred: boolean;
  pageCount: number;
  myRole: DocSpaceRole;
  createdBy: string;
  updatedAt: string;
}

export interface DocTreeNode {
  id: string;
  parentId: string | null;
  title: string;
  emoji?: string;
  position: number;
  status: 'draft' | 'published';
  locked: boolean;
  updatedAt: string;
}

export interface DocIssueRef {
  id: string;
  key?: string;
  title?: string;
  status?: string;
  type?: string;
  projectId?: string;
  /** The user is not on the issue's project, so only the key is shown. */
  hidden?: boolean;
}

export interface DocPage {
  id: string;
  space: { id: string; key: string; name: string; icon?: string; color?: string } | null;
  isHome: boolean;
  parentId: string | null;
  breadcrumbs: Array<{ id: string; title: string; emoji?: string }>;
  title: string;
  emoji?: string;
  content: string;
  status: 'draft' | 'published';
  locked: boolean;
  /** Pages fill the reading pane unless the author chose a narrow reading column. */
  narrow: boolean;
  labels: string[];
  version: number;
  starred: boolean;
  issues: DocIssueRef[];
  mentionedIssues: DocIssueRef[];
  projects: DocProjectRef[];
  children: Array<{ id: string; title: string; emoji?: string; updatedAt: string }>;
  commentCount: number;
  createdBy: DocPersonRef;
  updatedBy: DocPersonRef;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  myRole: DocSpaceRole;
  canEdit: boolean;
}

export interface DocPageCard {
  id: string;
  title: string;
  emoji?: string;
  status: 'draft' | 'published';
  excerpt: string;
  labels?: string[];
  space: { id: string; key: string; name: string; icon?: string; color?: string } | null;
  updatedAt: string;
  updatedBy: DocPersonRef | null;
  linkType?: 'linked' | 'mentioned';
}

export interface DocVersion {
  version: number;
  title: string;
  message?: string;
  author: DocPersonRef;
  createdAt: string;
  content?: string;
}

export interface DocComment {
  id: string;
  parentId: string | null;
  body: string;
  resolved: boolean;
  author: DocPersonRef;
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocTrashItem {
  id: string;
  title: string;
  emoji?: string;
  deletedAt: string;
  deletedBy: DocPersonRef | null;
  childCount: number;
}

export interface DocLinkedSpace {
  id: string;
  key: string;
  name: string;
  icon?: string;
  color?: string;
  description?: string;
  homePageId: string | null;
  myRole: DocSpaceRole;
}

export interface DocPageInput {
  spaceId?: string;
  parentId?: string | null;
  title?: string;
  emoji?: string;
  content?: string;
  status?: 'draft' | 'published';
  locked?: boolean;
  narrow?: boolean;
  labels?: string[];
  issueIds?: string[];
  projectIds?: string[];
  baseVersion?: number;
  message?: string;
}

export interface DocSpaceInput {
  key?: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  projectIds?: string[];
  audience?: DocSpaceAudience;
  audienceRole?: 'editor' | 'viewer';
  members?: Array<{ userId: string; role: DocSpaceRole }>;
  archived?: boolean;
  homePageId?: string | null;
}

function qs(params: Record<string, string | number | boolean | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
}

export const docsApi = {
  me: (token: string) => api.get<{ canCreateSpace: boolean; isDocsAdmin: boolean }>('/docs/me', token),
  overview: (token: string) =>
    api.get<{ recent: DocPageCard[]; starred: DocPageCard[]; drafts: DocPageCard[]; editedByMe: DocPageCard[] }>('/docs/overview', token),
  search: (params: { q?: string; spaceKey?: string; label?: string; limit?: number }, token: string) =>
    api.get<{ pages: DocPageCard[]; spaces: Array<{ id: string; key: string; name: string; icon?: string }> }>(`/docs/search${qs(params)}`, token),
  links: (params: { issueId?: string; projectId?: string }, token: string) =>
    api.get<{ pages: DocPageCard[]; spaces: DocLinkedSpace[] }>(`/docs/links${qs(params)}`, token),
  options: (token: string) => api.get<{ people: DocPersonRef[]; projects: DocProjectRef[] }>('/docs/options', token),
  lookupIssues: (params: { q?: string; projectId?: string }, token: string) =>
    api.get<DocIssueRef[]>(`/docs/lookup/issues${qs(params)}`, token),

  listSpaces: (token: string, params: { archived?: boolean; projectId?: string } = {}) =>
    api.get<DocSpace[]>(`/docs/spaces${qs(params)}`, token),
  getSpace: (key: string, token: string) => api.get<DocSpace>(`/docs/spaces/${encodeURIComponent(key)}`, token),
  createSpace: (data: DocSpaceInput, token: string) => api.post<DocSpace>('/docs/spaces', data, token),
  updateSpace: (key: string, data: DocSpaceInput, token: string) => api.patch<DocSpace>(`/docs/spaces/${encodeURIComponent(key)}`, data, token),
  deleteSpace: (key: string, token: string) => api.delete<{ deleted: boolean }>(`/docs/spaces/${encodeURIComponent(key)}`, token),
  starSpace: (key: string, starred: boolean, token: string) =>
    api.post<{ starred: boolean }>(`/docs/spaces/${encodeURIComponent(key)}/star`, { starred }, token),
  tree: (key: string, token: string) => api.get<DocTreeNode[]>(`/docs/spaces/${encodeURIComponent(key)}/tree`, token),
  trash: (key: string, token: string) => api.get<DocTrashItem[]>(`/docs/spaces/${encodeURIComponent(key)}/trash`, token),

  createPage: (data: DocPageInput, token: string) => api.post<DocPage>('/docs/pages', data, token),
  getPage: (id: string, token: string) => api.get<DocPage>(`/docs/pages/${id}`, token),
  updatePage: (id: string, data: DocPageInput, token: string) => api.patch<DocPage>(`/docs/pages/${id}`, data, token),
  trashPage: (id: string, token: string) => api.delete<{ trashed: number }>(`/docs/pages/${id}`, token),
  purgePage: (id: string, token: string) => api.delete<{ deleted: number }>(`/docs/pages/${id}?permanent=true`, token),
  restorePage: (id: string, token: string) => api.post<DocPage>(`/docs/pages/${id}/restore`, {}, token),
  movePage: (id: string, data: { parentId: string | null; index?: number; spaceId?: string }, token: string) =>
    api.post<{ moved: boolean }>(`/docs/pages/${id}/move`, data, token),
  starPage: (id: string, starred: boolean, token: string) => api.post<{ starred: boolean }>(`/docs/pages/${id}/star`, { starred }, token),
  versions: (id: string, token: string) => api.get<DocVersion[]>(`/docs/pages/${id}/versions`, token),
  version: (id: string, version: number, token: string) => api.get<DocVersion>(`/docs/pages/${id}/versions/${version}`, token),
  restoreVersion: (id: string, version: number, token: string) =>
    api.post<DocPage>(`/docs/pages/${id}/versions/${version}/restore`, {}, token),

  comments: (id: string, token: string) => api.get<DocComment[]>(`/docs/pages/${id}/comments`, token),
  addComment: (id: string, data: { body: string; parentId?: string | null }, token: string) =>
    api.post<DocComment[]>(`/docs/pages/${id}/comments`, data, token),
  updateComment: (id: string, commentId: string, data: { body?: string; resolved?: boolean }, token: string) =>
    api.patch<DocComment[]>(`/docs/pages/${id}/comments/${commentId}`, data, token),
  deleteComment: (id: string, commentId: string, token: string) => api.delete<DocComment[]>(`/docs/pages/${id}/comments/${commentId}`, token),
};
