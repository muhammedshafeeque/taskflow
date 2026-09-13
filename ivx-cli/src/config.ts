import fs from 'fs';
import os from 'os';
import path from 'path';

export type WorkspaceMap = {
  projectKey: string;
  projectId?: string;
  localPath: string;
};

export type IvxConfig = {
  apiBase: string;
  deviceId?: string;
  deviceToken?: string;
  name?: string;
  workspaces: WorkspaceMap[];
  allowCommands: string[];
  aiProviders: Array<'claude' | 'gemini'>;
  preferredAi?: 'claude' | 'gemini';
};

const DIR = path.join(os.homedir(), '.ivx');
const FILE = path.join(DIR, 'config.json');

export function configPath(): string {
  return FILE;
}

export function loadConfig(): IvxConfig {
  if (!fs.existsSync(FILE)) {
    return {
      apiBase: 'https://pa.repod.online',
      workspaces: [],
      allowCommands: [],
      aiProviders: ['claude', 'gemini'],
    };
  }
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Partial<IvxConfig>;
  return {
    apiBase: (raw.apiBase || 'https://pa.repod.online').replace(/\/$/, ''),
    deviceId: raw.deviceId,
    deviceToken: raw.deviceToken,
    name: raw.name,
    workspaces: raw.workspaces || [],
    allowCommands: raw.allowCommands || [],
    aiProviders: raw.aiProviders || ['claude', 'gemini'],
    preferredAi: raw.preferredAi,
  };
}

export function saveConfig(cfg: IvxConfig): void {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}
