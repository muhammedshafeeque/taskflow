/**
 * Proxy CustomerRequest + ServiceTicket ingest APIs for the Control Center.
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
      'Set TASKFLOW_API_URL and TASKFLOW_INGEST_SECRET for service requests'
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

export type CustomerRequestRow = {
  _id: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  status: string;
  workClassification?: string;
  linkedIssueKey?: string;
  linkedServiceTicketId?: string;
  createdAt?: string;
  updatedAt?: string;
  customerOrgId?: { name?: string; slug?: string } | string;
  projectId?: { name?: string; key?: string } | string;
  createdBy?: { name?: string; email?: string } | string;
};

export type ServiceTicketRow = {
  _id: string;
  subject: string;
  description?: string;
  status: string;
  priority: string;
  queue?: string;
  source?: string;
  linkedIssueId?: { key?: string; title?: string } | string;
  projectId?: { name?: string; key?: string } | string;
  updatedAt?: string;
};

export async function listCustomerRequests(opts: {
  status?: string;
  pendingOnly?: boolean;
  page?: number;
  limit?: number;
}): Promise<{
  requests: CustomerRequestRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const q = new URLSearchParams();
  if (opts.pendingOnly) q.set('pendingOnly', '1');
  if (opts.status) q.set('status', opts.status);
  if (opts.page) q.set('page', String(opts.page));
  if (opts.limit) q.set('limit', String(opts.limit));
  const qs = q.toString();
  return ingestFetch(`/api/service/ingest/requests${qs ? `?${qs}` : ''}`);
}

export async function getCustomerRequest(
  id: string
): Promise<{ request: CustomerRequestRow }> {
  return ingestFetch(`/api/service/ingest/requests/${encodeURIComponent(id)}`);
}

export async function approveCustomerRequest(
  id: string,
  body: {
    workClassification: 'billable_change' | 'fix';
    note?: string;
  }
): Promise<{ request: unknown }> {
  return ingestFetch(
    `/api/service/ingest/requests/${encodeURIComponent(id)}/approve`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function rejectCustomerRequest(
  id: string,
  body: { reason?: string; note?: string }
): Promise<{ request: unknown }> {
  return ingestFetch(
    `/api/service/ingest/requests/${encodeURIComponent(id)}/reject`,
    { method: 'POST', body: JSON.stringify(body) }
  );
}

export async function listServiceTickets(opts: {
  status?: string;
  queue?: string;
}): Promise<{ tickets: ServiceTicketRow[] }> {
  const q = new URLSearchParams();
  if (opts.status) q.set('status', opts.status);
  if (opts.queue) q.set('queue', opts.queue);
  const qs = q.toString();
  return ingestFetch(
    `/api/service/ingest/service-tickets${qs ? `?${qs}` : ''}`
  );
}

export async function updateServiceTicket(
  id: string,
  body: {
    status?: string;
    priority?: string;
    queue?: string;
    comment?: string;
  }
): Promise<{ ticket: unknown }> {
  return ingestFetch(
    `/api/service/ingest/service-tickets/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  );
}
