import { env } from '../../config/env';

/** Error from the Atrium API, with the HTTP status it answered. */
export class AtriumApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Calls Atrium's own REST API as the user the MCP request came from: the same token and workspace header
 * are forwarded, so every route-level permission and project-membership check applies unchanged.
 * Nothing here talks to the database directly.
 */
export class AtriumApi {
  private readonly base: string;

  constructor(
    private readonly authorization: string,
    private readonly organizationId?: string,
    base = process.env.MCP_LOOPBACK_URL || `http://127.0.0.1:${env.port}/api`
  ) {
    this.base = base.replace(/\/$/, '');
  }

  async request<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: this.authorization, Accept: 'application/json' };
    if (this.organizationId) headers['X-Organization-Id'] = this.organizationId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; message?: string };
    if (!res.ok || json.success === false) {
      throw new AtriumApiError(res.status, json.message || res.statusText || 'Request failed');
    }
    return json.data as T;
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined | null>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    return this.request<T>('GET', s ? `${path}?${s}` : path);
  }

  post<T = unknown>(path: string, body: unknown) {
    return this.request<T>('POST', path, body);
  }

  patch<T = unknown>(path: string, body: unknown) {
    return this.request<T>('PATCH', path, body);
  }
}
