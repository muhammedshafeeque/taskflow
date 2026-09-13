/**
 * TaskFlow ingest client for KB / portal / issues / billing / HR / assets.
 */
function apiBase(): string | null {
  const url = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  return url || null;
}

function ingestHeaders(): Record<string, string> | null {
  const secret = process.env.TASKFLOW_INGEST_SECRET?.trim();
  if (!secret) return null;
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-pa-ingest-secret': secret,
  };
  const orgId = process.env.TASKFLOW_ORG_ID?.trim();
  if (orgId) h['x-organization-id'] = orgId;
  return h;
}

async function ingestFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const base = apiBase();
  const headers = ingestHeaders();
  if (!base || !headers) {
    throw new Error(
      'Set TASKFLOW_API_URL and TASKFLOW_INGEST_SECRET for TaskFlow ingest'
    );
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) },
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
    data?: T;
  };
  if (!res.ok || json.success === false) {
    throw new Error(
      json.error || json.message || `TaskFlow request failed (${res.status})`
    );
  }
  return json.data as T;
}

export type CustomerOrgOption = {
  id: string;
  name: string;
  slug?: string;
  crmAccountId?: string;
};

export type KbArticleHit = {
  id: string;
  title: string;
  slug?: string;
  category?: string;
  body: string;
};

export async function searchKb(q: string) {
  const qs = new URLSearchParams({ q });
  return ingestFetch<{ articles: KbArticleHit[] }>(
    `/api/service/ingest/kb/search?${qs}`
  );
}

export async function listCustomerOrgs() {
  return ingestFetch<{ orgs: CustomerOrgOption[] }>(
    '/api/service/ingest/customer-orgs'
  );
}

export async function createPortalRequest(input: {
  customerOrgId: string;
  projectId: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  whatsappGroupId?: string;
  senderPhone?: string;
}) {
  return ingestFetch<{ request: { _id?: string; title?: string; status?: string } }>(
    '/api/service/ingest/requests',
    { method: 'POST', body: JSON.stringify(input) }
  );
}

export async function listTicketDigest(opts: {
  customerOrgId?: string;
  whatsappGroupId?: string;
  status?: string;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (opts.customerOrgId) qs.set('customerOrgId', opts.customerOrgId);
  if (opts.whatsappGroupId) qs.set('whatsappGroupId', opts.whatsappGroupId);
  if (opts.status) qs.set('status', opts.status);
  if (opts.limit) qs.set('limit', String(opts.limit));
  return ingestFetch<{
    tickets: Array<{
      _id: string;
      subject: string;
      status: string;
      priority: string;
      linkedIssueKey?: string;
    }>;
  }>(`/api/service/ingest/service-tickets?${qs}`);
}

export async function getIssueByKey(key: string, projectId: string) {
  const qs = new URLSearchParams({ key, projectId });
  return ingestFetch<{
    issue: {
      key: string;
      title: string;
      status: string;
      type?: string;
      priority?: string;
      assignee?: string;
      sprintName?: string;
      sprintStatus?: string;
    };
  }>(`/api/service/ingest/issues/by-key?${qs}`);
}

export async function getBillingSummary(opts: {
  customerOrgId?: string;
  accountId?: string;
}) {
  const qs = new URLSearchParams();
  if (opts.customerOrgId) qs.set('customerOrgId', opts.customerOrgId);
  if (opts.accountId) qs.set('accountId', opts.accountId);
  return ingestFetch<{
    outstanding: number;
    openCount: number;
    recent: Array<{ number?: string; status: string; total: number }>;
  }>(`/api/service/ingest/billing/summary?${qs}`);
}

export async function getHrmsMe(opts: { phone?: string; email?: string }) {
  const qs = new URLSearchParams();
  if (opts.phone) qs.set('phone', opts.phone);
  if (opts.email) qs.set('email', opts.email);
  return ingestFetch<{
    linked: boolean;
    reason?: string;
    employee?: {
      name: string;
      employeeCode: string;
      leaveBalanceDays: number;
      department?: string;
      status?: string;
    };
    recentLeaves?: Array<{ status: string; days: number; type?: string }>;
    recentAttendance?: Array<{ date: string; status: string }>;
  }>(`/api/service/ingest/hrms/me?${qs}`);
}

export async function searchAssets(q: string) {
  const qs = new URLSearchParams({ q });
  return ingestFetch<{
    assets: Array<{
      name?: string;
      status?: string;
      assetTag?: string;
      assignedUser?: string;
    }>;
  }>(`/api/service/ingest/assets/search?${qs}`);
}

export async function searchPurchaseOrders(opts: { q?: string; status?: string }) {
  const qs = new URLSearchParams();
  if (opts.q) qs.set('q', opts.q);
  if (opts.status) qs.set('status', opts.status);
  return ingestFetch<{
    purchaseOrders: Array<{
      poNumber?: string;
      title?: string;
      status?: string;
      total?: number;
    }>;
  }>(`/api/service/ingest/procurement/pos?${qs}`);
}
