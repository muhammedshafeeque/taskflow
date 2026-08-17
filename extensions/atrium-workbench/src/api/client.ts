import type { SessionStore, AtriumUser, AuthTokens } from '../auth/session';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export class AtriumApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export class AtriumClient {
  constructor(private readonly session: SessionStore) {}

  apiRoot(): string {
    const base = this.session.getApiBaseUrl();
    if (!base) throw new AtriumApiError('Configure Atrium server URL first', 0);
    return `${base}/api`;
  }

  private async headers(withAuth: boolean): Promise<Record<string, string>> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (withAuth) {
      const token = await this.session.getAccessToken();
      if (token) h.Authorization = `Bearer ${token}`;
      const org = this.session.getOrganizationId();
      if (org) h['X-Organization-Id'] = org;
    }
    return h;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { auth?: boolean; retry?: boolean }
  ): Promise<T> {
    const auth = opts?.auth !== false;
    const retry = opts?.retry !== false;
    const url = `${this.apiRoot()}${path.startsWith('/') ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: await this.headers(auth),
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && auth && retry) {
      const refreshed = await this.tryRefresh();
      if (refreshed) {
        return this.request<T>(method, path, body, { auth, retry: false });
      }
    }

    let json: ApiEnvelope<T> | undefined;
    try {
      json = (await res.json()) as ApiEnvelope<T>;
    } catch {
      json = undefined;
    }

    if (!res.ok || !json?.success) {
      throw new AtriumApiError(json?.message || `Request failed (${res.status})`, res.status);
    }
    return json.data as T;
  }

  private async tryRefresh(): Promise<boolean> {
    const refreshToken = await this.session.getRefreshToken();
    if (!refreshToken) return false;
    try {
      const data = await this.request<{ user: AtriumUser; tokens: AuthTokens }>(
        'POST',
        '/auth/refresh',
        { refreshToken },
        { auth: false, retry: false }
      );
      await this.session.setSession(data.user, data.tokens);
      return true;
    } catch {
      await this.session.clear();
      return false;
    }
  }

  get<T>(path: string) {
    return this.request<T>('GET', path);
  }

  post<T>(path: string, body?: unknown, opts?: { auth?: boolean }) {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, body);
  }
}
