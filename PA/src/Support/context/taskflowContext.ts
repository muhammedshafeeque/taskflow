/**
 * TaskFlow read/write helpers for the support pipeline (ingest secret).
 */

export type TaskflowTicketSummary = {
  id: string;
  /** Display id — project issue key when linked (e.g. SDFSDF-6) */
  key?: string;
  issueKey?: string;
  linkedIssueId?: string;
  subject: string;
  description?: string;
  status?: string;
  priority?: string;
  projectId?: string;
  queue?: string;
};

export type TaskflowProjectContext = {
  available: boolean;
  reason?: string;
  projects: Array<{
    id: string;
    name: string;
    key?: string;
    description?: string;
  }>;
  tickets: TaskflowTicketSummary[];
  recentIssues: Array<{
    id: string;
    key?: string;
    title: string;
    status?: string;
  }>;
};

function apiBase(): string | null {
  const url = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  return url || null;
}

function ingestHeaders(): Record<string, string> | null {
  const secret = process.env.TASKFLOW_INGEST_SECRET?.trim();
  if (!secret) return null;
  const orgId = process.env.TASKFLOW_ORG_ID?.trim();
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-pa-ingest-secret': secret,
  };
  if (orgId) h['x-organization-id'] = orgId;
  return h;
}

export async function fetchProjectSupportContext(
  projectIds: string[]
): Promise<TaskflowProjectContext> {
  const base = apiBase();
  const headers = ingestHeaders();
  if (!base || !headers) {
    return {
      available: false,
      reason: 'TASKFLOW_API_URL / TASKFLOW_INGEST_SECRET not set',
      projects: [],
      tickets: [],
      recentIssues: [],
    };
  }
  if (!projectIds.length) {
    return {
      available: true,
      projects: [],
      tickets: [],
      recentIssues: [],
    };
  }

  try {
    const qs = new URLSearchParams({
      projectIds: projectIds.join(','),
    });
    const res = await fetch(
      `${base}/api/service/ingest/project-context?${qs}`,
      { headers }
    );
    if (!res.ok) {
      const body = await res.text();
      console.warn('project-context failed', res.status, body.slice(0, 200));
      return {
        available: false,
        reason: `project-context ${res.status}`,
        projects: [],
        tickets: [],
        recentIssues: [],
      };
    }
    const json = (await res.json()) as {
      data?: {
        projects?: TaskflowProjectContext['projects'];
        tickets?: TaskflowTicketSummary[];
        recentIssues?: TaskflowProjectContext['recentIssues'];
      };
    };
    return {
      available: true,
      projects: json.data?.projects || [],
      tickets: json.data?.tickets || [],
      recentIssues: json.data?.recentIssues || [],
    };
  } catch (err) {
    console.warn('project-context error', err);
    return {
      available: false,
      reason: 'project-context request failed',
      projects: [],
      tickets: [],
      recentIssues: [],
    };
  }
}

export async function createServiceTicket(input: {
  projectId: string;
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  whatsappGroupId?: string;
  whatsappMessageId?: string;
  supportConversationId?: string;
  aiAnalysis?: unknown;
  qaAnalysis?: unknown;
  workClassification?: 'billable_change' | 'fix';
  createIssue?: boolean;
}): Promise<{
  id: string;
  subject: string;
  linkedIssueId?: string;
  linkedIssueKey?: string;
} | null> {
  const base = apiBase();
  const headers = ingestHeaders();
  if (!base || !headers) return null;

  try {
    const res = await fetch(`${base}/api/service/ingest/tickets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...input, createIssue: input.createIssue !== false }),
    });
    if (!res.ok) {
      console.warn(
        'create ticket failed',
        res.status,
        (await res.text()).slice(0, 300)
      );
      return null;
    }
    const json = (await res.json()) as {
      data?: {
        _id?: string;
        id?: string;
        subject?: string;
        key?: string;
        linkedIssueId?: string;
        linkedIssueKey?: string;
      };
    };
    const id = String(json.data?._id || json.data?.id || '');
    if (!id) return null;
    const linkedIssueKey =
      json.data?.linkedIssueKey || json.data?.key || undefined;
    return {
      id,
      subject: String(json.data?.subject || input.subject),
      linkedIssueId: json.data?.linkedIssueId
        ? String(json.data.linkedIssueId)
        : undefined,
      linkedIssueKey: linkedIssueKey ? String(linkedIssueKey) : undefined,
    };
  } catch (err) {
    console.warn('create ticket error', err);
    return null;
  }
}

export async function linkTicketComment(input: {
  ticketId: string;
  body: string;
  whatsappMessageId?: string;
  whatsappGroupId?: string;
}): Promise<{ ok: boolean; key?: string; id?: string }> {
  const base = apiBase();
  const headers = ingestHeaders();
  if (!base || !headers) return { ok: false };
  try {
    const res = await fetch(
      `${base}/api/service/ingest/tickets/${encodeURIComponent(input.ticketId)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          comment: input.body,
          internal: true,
          whatsappMessageId: input.whatsappMessageId,
          whatsappGroupId: input.whatsappGroupId,
        }),
      }
    );
    if (!res.ok) {
      console.warn('link ticket failed', res.status);
      return { ok: false };
    }
    const json = (await res.json()) as {
      data?: { key?: string; issueKey?: string; id?: string; _id?: string };
    };
    return {
      ok: true,
      key: json.data?.issueKey || json.data?.key,
      id: String(json.data?.id || json.data?._id || input.ticketId),
    };
  } catch (err) {
    console.warn('link ticket error', err);
    return { ok: false };
  }
}

export function mapPriority(
  p?: string
): 'low' | 'medium' | 'high' | 'urgent' {
  const u = String(p || 'MEDIUM').toUpperCase();
  if (u === 'LOW') return 'low';
  if (u === 'HIGH') return 'high';
  if (u === 'URGENT') return 'urgent';
  return 'medium';
}
