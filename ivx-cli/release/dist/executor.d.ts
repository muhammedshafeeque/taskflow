import { type AgentJob } from './api';
import type { IvxConfig } from './config';
export declare function detectAi(): Promise<{
    claude: boolean;
    gemini: boolean;
}>;
export declare function executeJob(cfg: IvxConfig, job: AgentJob): Promise<void>;
