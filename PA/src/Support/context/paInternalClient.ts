/**
 * Client-scoped Atrium internal API for WhatsApp chats.
 * Auth: ATRIUM_INTERNAL_SECRET (or TASKFLOW_INTERNAL_SECRET) + x-pa-actor=client + x-pa-chat-id.
 */
function apiBase(): string | null {
  const url = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  return url || null;
}

function internalKey(): string | null {
  return (
    process.env.ATRIUM_INTERNAL_SECRET?.trim() ||
    process.env.TASKFLOW_INTERNAL_SECRET?.trim() ||
    null
  );
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(Number(process.env.TASKFLOW_TIMEOUT_MS) || 8000);
}

export type PaDocHit = {
  id: string;
  title: string;
  emoji?: string;
  excerpt: string;
  body?: string;
  spaceKey?: string;
  spaceName?: string;
  url?: string;
  linkType?: string;
};

async function clientFetch<T>(
  path: string,
  chatId: string,
  opts: { senderPhone?: string; method?: string; body?: unknown } = {}
): Promise<T> {
  const base = apiBase();
  const key = internalKey();
  if (!base || !key) {
    throw new Error(
      'Set TASKFLOW_API_URL and ATRIUM_INTERNAL_SECRET for client-scoped Atrium docs'
    );
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-atrium-internal-key': key,
    'x-pa-actor': 'client',
    'x-pa-chat-id': chatId,
  };
  const orgId = process.env.TASKFLOW_ORG_ID?.trim();
  if (orgId) headers['x-organization-id'] = orgId;
  if (opts.senderPhone) headers['x-pa-sender-phone'] = opts.senderPhone;

  const res = await fetch(`${base}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    signal: timeoutSignal(),
  });
  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    message?: string;
    data?: T;
  };
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || `Atrium request failed (${res.status})`);
  }
  return json.data as T;
}

export async function searchClientDocs(
  chatId: string,
  params: {
    q?: string;
    projectId?: string;
    issueId?: string;
    issueKey?: string;
    ticketId?: string;
    limit?: number;
    withBody?: boolean;
    senderPhone?: string;
  } = {}
): Promise<{ pages: PaDocHit[] }> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.projectId) sp.set('projectId', params.projectId);
  if (params.issueId) sp.set('issueId', params.issueId);
  if (params.issueKey) sp.set('issueKey', params.issueKey);
  if (params.ticketId) sp.set('ticketId', params.ticketId);
  if (params.limit != null) sp.set('limit', String(params.limit));
  if (params.withBody) sp.set('body', '1');
  const q = sp.toString();
  return clientFetch<{ pages: PaDocHit[] }>(
    `/api/internal/pa/client/docs${q ? `?${q}` : ''}`,
    chatId,
    { senderPhone: params.senderPhone }
  );
}

export type ProjectDocContext = { title: string; url?: string; body: string };

/**
 * Doc pages relevant to a chat message, with their text, for the agents to read
 * and answer from. Empty when the chat isn't linked or nothing matches.
 */
export async function readDocsForQuestion(
  chatId: string,
  question: string,
  senderPhone?: string
): Promise<ProjectDocContext[]> {
  try {
    const { pages } = await searchClientDocs(chatId, {
      q: question.slice(0, 300),
      limit: 3,
      withBody: true,
      senderPhone,
    });
    return (pages || []).map((p) => ({
      title: p.title,
      url: p.url,
      body: (p.body || p.excerpt || '').trim(),
    }));
  } catch {
    // ATRIUM_INTERNAL_SECRET or the chat binding may be unset.
    return [];
  }
}

export async function getClientDoc(
  chatId: string,
  pageId: string,
  senderPhone?: string
): Promise<PaDocHit> {
  return clientFetch<PaDocHit>(
    `/api/internal/pa/client/docs/${encodeURIComponent(pageId)}`,
    chatId,
    { senderPhone }
  );
}

export async function searchClientKb(
  chatId: string,
  q: string,
  senderPhone?: string
): Promise<{
  articles: Array<{ id: string; title: string; slug?: string; category?: string; body: string }>;
}> {
  const qs = new URLSearchParams({ q });
  return clientFetch(
    `/api/internal/pa/client/kb/search?${qs}`,
    chatId,
    { senderPhone }
  );
}
