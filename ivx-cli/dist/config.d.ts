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
export declare function configPath(): string;
export declare function loadConfig(): IvxConfig;
export declare function saveConfig(cfg: IvxConfig): void;
