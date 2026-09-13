export declare function redactLogLine(line: string): string;
export declare function isCommandAllowed(command: string, allowCommands: string[]): boolean;
export declare function assertPathJail(localPath: string, roots?: string[]): string;
export declare function commandToArgv(command: string): string[];
