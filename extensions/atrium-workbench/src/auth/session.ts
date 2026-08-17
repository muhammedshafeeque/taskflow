import * as vscode from 'vscode';

const ACCESS_KEY = 'atrium.accessToken';
const REFRESH_KEY = 'atrium.refreshToken';
const USER_KEY = 'atrium.userJson';

export interface AtriumUser {
  id: string;
  email: string;
  name: string;
  activeOrganizationId?: string;
  organizations?: Array<{ id: string; name: string; slug?: string }>;
  userType?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: string;
}

export class SessionStore {
  constructor(private readonly secrets: vscode.SecretStorage, private readonly context: vscode.ExtensionContext) {}

  getApiBaseUrl(): string {
    return (vscode.workspace.getConfiguration('atrium').get<string>('apiBaseUrl') || '').replace(/\/$/, '');
  }

  getWebBaseUrl(): string {
    const web = (vscode.workspace.getConfiguration('atrium').get<string>('webBaseUrl') || '').replace(/\/$/, '');
    return web || this.getApiBaseUrl();
  }

  getOrganizationId(): string {
    return vscode.workspace.getConfiguration('atrium').get<string>('organizationId') || '';
  }

  async setOrganizationId(id: string): Promise<void> {
    await vscode.workspace.getConfiguration('atrium').update('organizationId', id, vscode.ConfigurationTarget.Global);
  }

  async setApiBaseUrl(url: string): Promise<void> {
    const cleaned = url.replace(/\/$/, '').replace(/\/api$/, '');
    await vscode.workspace.getConfiguration('atrium').update('apiBaseUrl', cleaned, vscode.ConfigurationTarget.Global);
  }

  async getAccessToken(): Promise<string | undefined> {
    return this.secrets.get(ACCESS_KEY);
  }

  async getRefreshToken(): Promise<string | undefined> {
    return this.secrets.get(REFRESH_KEY);
  }

  async getUser(): Promise<AtriumUser | undefined> {
    const raw = this.context.globalState.get<string>(USER_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AtriumUser;
    } catch {
      return undefined;
    }
  }

  async setSession(user: AtriumUser, tokens: AuthTokens): Promise<void> {
    await this.secrets.store(ACCESS_KEY, tokens.accessToken);
    await this.secrets.store(REFRESH_KEY, tokens.refreshToken);
    await this.context.globalState.update(USER_KEY, JSON.stringify(user));
    if (user.activeOrganizationId) {
      await this.setOrganizationId(user.activeOrganizationId);
    }
  }

  async clear(): Promise<void> {
    await this.secrets.delete(ACCESS_KEY);
    await this.secrets.delete(REFRESH_KEY);
    await this.context.globalState.update(USER_KEY, undefined);
  }

  async isSignedIn(): Promise<boolean> {
    return Boolean(await this.getAccessToken());
  }
}
