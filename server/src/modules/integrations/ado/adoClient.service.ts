export const ADO_API_VERSION = '7.1';
export const ADO_BASE_URL = 'https://dev.azure.com';
export const WORKITEMS_CHUNK = 200;

export interface AdoWorkItem {
  id: number;
  rev?: number;
  fields?: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }>;
}

export interface AdoJsonPatchOp {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: unknown;
}

export interface AdoConnection {
  org: string;
  adoProject: string;
  pat: string;
}

export function adoAuthHeader(pat: string): Record<string, string> {
  const token = Buffer.from(`:${pat}`, 'utf8').toString('base64');
  return { Authorization: `Basic ${token}`, 'Content-Type': 'application/json' };
}

export function escapeWiqlString(s: string): string {
  return s.replace(/'/g, "''");
}

export function extractIdFromWorkItemUrl(url: string): number | null {
  const m = /\/workitems\/(\d+)/i.exec(url);
  return m ? parseInt(m[1], 10) : null;
}

export function buildAdoWorkItemUrl(org: string, adoProject: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(adoProject)}/_workitems/edit/${id}`;
}

export function parseIdentityEmail(field: unknown): string | undefined {
  if (field == null) return undefined;
  if (typeof field === 'string') {
    const t = field.trim();
    if (t.includes('@')) return t.toLowerCase();
    return undefined;
  }
  if (typeof field === 'object' && 'uniqueName' in (field as object)) {
    const u = field as { uniqueName?: string };
    const name = (u.uniqueName || '').trim();
    if (name.includes('@')) return name.toLowerCase();
  }
  return undefined;
}

export function parseIdentityDisplayName(field: unknown): string | undefined {
  if (field == null) return undefined;
  if (typeof field === 'object') {
    const obj = field as { displayName?: string; name?: string };
    const display = (obj.displayName || obj.name || '').trim();
    if (display) return display;
  }
  if (typeof field === 'string') {
    const t = field.trim();
    if (t && !t.includes('@')) return t;
  }
  return undefined;
}

export function mapPriorityFromAdo(p: unknown): string {
  if (typeof p === 'number' && Number.isFinite(p)) {
    if (p === 1) return 'Highest';
    if (p === 2) return 'High';
    if (p === 3) return 'Medium';
    if (p === 4) return 'Low';
  }
  if (typeof p === 'string' && p.trim()) return p.trim();
  return 'Medium';
}

export function mapPriorityToAdo(priority: string): number {
  const p = priority.toLowerCase();
  if (p === 'highest' || p === 'critical') return 1;
  if (p === 'high') return 2;
  if (p === 'low') return 4;
  if (p === 'lowest') return 4;
  return 3;
}

export function parseTags(tags: unknown): string[] {
  if (typeof tags !== 'string' || !tags.trim()) return [];
  return tags
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function formatTags(labels: string[]): string {
  return labels.filter(Boolean).join('; ');
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function getParentAdoId(item: AdoWorkItem): number | undefined {
  const rels = item.relations;
  if (!rels?.length) return undefined;
  for (const r of rels) {
    if (r.rel === 'System.LinkTypes.Hierarchy-Reverse') {
      const pid = extractIdFromWorkItemUrl(r.url);
      if (pid != null) return pid;
    }
  }
  return undefined;
}

function projectBase(conn: AdoConnection): string {
  return `${ADO_BASE_URL}/${encodeURIComponent(conn.org)}/${encodeURIComponent(conn.adoProject)}`;
}

export async function wiqlQuery(conn: AdoConnection, query: string): Promise<number[]> {
  const url = `${projectBase(conn)}/_apis/wit/wiql?api-version=${ADO_API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: adoAuthHeader(conn.pat),
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`WIQL failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { workItems?: Array<{ id: number }> };
  return (data.workItems || []).map((w) => w.id);
}

export interface AdoWorkItemFieldUpdate {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface AdoWorkItemUpdate {
  id: number;
  rev: number;
  revisedBy?: { displayName?: string; uniqueName?: string };
  revisedDate: string;
  fields?: Record<string, AdoWorkItemFieldUpdate>;
}

export async function getWorkItem(conn: AdoConnection, id: number): Promise<AdoWorkItem> {
  const url = `${projectBase(conn)}/_apis/wit/workitems/${id}?$expand=all&api-version=${ADO_API_VERSION}`;
  const res = await fetch(url, { headers: adoAuthHeader(conn.pat) });
  if (!res.ok) throw new Error(`Get work item failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as AdoWorkItem;
}

export async function getWorkItemUpdates(
  conn: AdoConnection,
  id: number,
  options: { top?: number; skip?: number } = {}
): Promise<AdoWorkItemUpdate[]> {
  const params = new URLSearchParams({ 'api-version': ADO_API_VERSION });
  if (options.top != null) params.set('$top', String(options.top));
  if (options.skip != null) params.set('$skip', String(options.skip));
  const url = `${projectBase(conn)}/_apis/wit/workitems/${id}/updates?${params}`;
  const res = await fetch(url, { headers: adoAuthHeader(conn.pat) });
  if (!res.ok) throw new Error(`Get work item updates failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { value?: AdoWorkItemUpdate[] };
  return data.value ?? [];
}

export async function getWorkItemsByIds(conn: AdoConnection, ids: number[]): Promise<AdoWorkItem[]> {
  if (ids.length === 0) return [];
  const idParam = ids.join(',');
  const url = `${projectBase(conn)}/_apis/wit/workitems?ids=${idParam}&$expand=all&api-version=${ADO_API_VERSION}`;
  const res = await fetch(url, { headers: adoAuthHeader(conn.pat) });
  if (!res.ok) throw new Error(`Get work items failed ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { value?: AdoWorkItem[] };
  return data.value || [];
}

export async function createWorkItem(
  conn: AdoConnection,
  workItemType: string,
  patches: AdoJsonPatchOp[]
): Promise<AdoWorkItem> {
  const url = `${projectBase(conn)}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=${ADO_API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...adoAuthHeader(conn.pat),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patches),
  });
  if (!res.ok) throw new Error(`Create work item failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as AdoWorkItem;
}

export async function updateWorkItem(
  conn: AdoConnection,
  id: number,
  patches: AdoJsonPatchOp[]
): Promise<AdoWorkItem> {
  if (patches.length === 0) throw new Error('No patches to apply');
  const url = `${projectBase(conn)}/_apis/wit/workitems/${id}?api-version=${ADO_API_VERSION}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      ...adoAuthHeader(conn.pat),
      'Content-Type': 'application/json-patch+json',
    },
    body: JSON.stringify(patches),
  });
  if (!res.ok) throw new Error(`Update work item failed ${res.status}: ${await res.text()}`);
  return (await res.json()) as AdoWorkItem;
}

export async function fetchProjectWorkItemStates(conn: AdoConnection): Promise<string[]> {
  const states = new Set<string>();

  const typesUrl = `${projectBase(conn)}/_apis/wit/workitemtypes?api-version=${ADO_API_VERSION}`;
  const typesRes = await fetch(typesUrl, { headers: adoAuthHeader(conn.pat) });
  const typeNames: string[] = [];
  if (typesRes.ok) {
    const typesData = (await typesRes.json()) as { value?: Array<{ name: string }> };
    for (const t of typesData.value || []) {
      if (t.name) typeNames.push(t.name);
    }
  }

  for (const typeName of typeNames) {
    const statesUrl = `${projectBase(conn)}/_apis/wit/workitemtypes/${encodeURIComponent(typeName)}/states?api-version=${ADO_API_VERSION}`;
    const statesRes = await fetch(statesUrl, { headers: adoAuthHeader(conn.pat) });
    if (!statesRes.ok) continue;
    const statesData = (await statesRes.json()) as { value?: Array<{ name: string }> };
    for (const s of statesData.value || []) {
      if (s.name) states.add(s.name);
    }
  }

  try {
    const wiql = `SELECT [System.Id], [System.State] FROM WorkItems WHERE [System.TeamProject] = '${escapeWiqlString(conn.adoProject)}'`;
    const ids = await wiqlQuery(conn, wiql);
    const sampleIds = ids.slice(0, Math.min(ids.length, 50));
    if (sampleIds.length > 0) {
      const items = await getWorkItemsByIds(conn, sampleIds);
      for (const item of items) {
        const state = item.fields?.['System.State'];
        if (typeof state === 'string' && state.trim()) states.add(state.trim());
      }
    }
  } catch {
    // ignore sampling errors
  }

  return Array.from(states).sort((a, b) => a.localeCompare(b));
}

export async function testConnection(conn: AdoConnection): Promise<{ ok: boolean; states: string[]; types: string[] }> {
  const orgUrl = `${ADO_BASE_URL}/${encodeURIComponent(conn.org)}/_apis/projects?api-version=${ADO_API_VERSION}`;
  const res = await fetch(orgUrl, { headers: adoAuthHeader(conn.pat) });
  if (!res.ok) throw new Error(`Connection test failed ${res.status}: ${await res.text()}`);

  const types: string[] = [];
  const typesUrl = `${projectBase(conn)}/_apis/wit/workitemtypes?api-version=${ADO_API_VERSION}`;
  const typesRes = await fetch(typesUrl, { headers: adoAuthHeader(conn.pat) });
  if (typesRes.ok) {
    const typesData = (await typesRes.json()) as { value?: Array<{ name: string }> };
    for (const t of typesData.value || []) {
      if (t.name && !types.includes(t.name)) types.push(t.name);
    }
  }

  const states = await fetchProjectWorkItemStates(conn);

  return { ok: true, states, types };
}
