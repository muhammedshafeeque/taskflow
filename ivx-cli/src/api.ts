import { request } from 'undici';
import { loadConfig, type IvxConfig } from './config';

export type AgentJob = {
  id: string;
  type: 'fix_issue' | 'follow_up' | 'run_command' | 'deploy';
  status: string;
  deviceId: string;
  issueKey?: string;
  projectId?: string;
  projectKey?: string;
  instruction?: string;
  command?: string;
  issueContext?: {
    key?: string;
    title?: string;
    status?: string;
    type?: string;
    priority?: string;
    assignee?: string;
  };
  parentJobId?: string;
  summary?: string;
  workspaces?: Array<{
    projectKey: string;
    projectId?: string;
    localPath: string;
  }>;
  allowCommands?: string[];
  aiProviders?: string[];
};

async function api<T>(
  cfg: IvxConfig,
  method: string,
  path: string,
  body?: unknown,
  auth = true
): Promise<T | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    if (!cfg.deviceToken) throw new Error('Not paired — run: ivx pair <code>');
    headers.Authorization = `Bearer ${cfg.deviceToken}`;
  }
  const res = await request(`${cfg.apiBase}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.statusCode === 204) return null;
  const json = (await res.body.json()) as {
    success?: boolean;
    error?: string;
    data?: T;
  };
  if (res.statusCode >= 400 || json.success === false) {
    throw new Error(json.error || `HTTP ${res.statusCode}`);
  }
  return json.data as T;
}

export async function register(pairingCode: string, name?: string) {
  const cfg = loadConfig();
  return api<{
    deviceId: string;
    deviceToken: string;
  }>(cfg, 'POST', '/api/agent/device/register', { pairingCode, name }, false);
}

export async function heartbeat(cfg: IvxConfig) {
  return api(cfg, 'POST', '/api/agent/device/heartbeat', {
    name: cfg.name,
    workspaces: cfg.workspaces,
    allowCommands: cfg.allowCommands,
    aiProviders: cfg.aiProviders,
  });
}

export async function nextJob(cfg: IvxConfig, waitSec = 25) {
  return api<AgentJob>(
    cfg,
    'GET',
    `/api/agent/device/jobs/next?wait=${waitSec}`
  );
}

export async function appendLogs(
  cfg: IvxConfig,
  jobId: string,
  lines: string[]
) {
  return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/logs`, { lines });
}

export async function needsReview(
  cfg: IvxConfig,
  jobId: string,
  body: { summary?: string; diffStat?: string; artifacts?: unknown[] }
) {
  return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/needs-review`, body);
}

export async function complete(
  cfg: IvxConfig,
  jobId: string,
  body: { summary?: string; diffStat?: string }
) {
  return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/complete`, body);
}

export async function fail(cfg: IvxConfig, jobId: string, error: string) {
  return api(cfg, 'POST', `/api/agent/device/jobs/${jobId}/fail`, { error });
}

export function setApiBase(url: string) {
  const cfg = loadConfig();
  cfg.apiBase = url.replace(/\/$/, '');
  return cfg;
}
