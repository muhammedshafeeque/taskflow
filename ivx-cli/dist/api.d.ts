import { type IvxConfig } from './config';
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
export declare function register(pairingCode: string, name?: string): Promise<{
    deviceId: string;
    deviceToken: string;
} | null>;
export declare function heartbeat(cfg: IvxConfig): Promise<unknown>;
export declare function nextJob(cfg: IvxConfig, waitSec?: number): Promise<AgentJob | null>;
export declare function appendLogs(cfg: IvxConfig, jobId: string, lines: string[]): Promise<unknown>;
export declare function needsReview(cfg: IvxConfig, jobId: string, body: {
    summary?: string;
    diffStat?: string;
    artifacts?: unknown[];
}): Promise<unknown>;
export declare function complete(cfg: IvxConfig, jobId: string, body: {
    summary?: string;
    diffStat?: string;
}): Promise<unknown>;
export declare function fail(cfg: IvxConfig, jobId: string, error: string): Promise<unknown>;
export declare function setApiBase(url: string): IvxConfig;
