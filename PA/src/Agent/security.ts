import path from 'path';

const SECRET_RE = /(SECRET|TOKEN|API[_-]?KEY|PASSWORD|BEARER)/i;

export function redactLogLine(line: string): string {
  if (!SECRET_RE.test(line)) return line.slice(0, 4000);
  return line
    .replace(
      /(SECRET|TOKEN|API[_-]?KEY|PASSWORD|BEARER)\s*[:=]\s*\S+/gi,
      '$1=[REDACTED]'
    )
    .slice(0, 4000);
}

/** Exact match only for allowlisted commands. */
export function isCommandAllowed(
  command: string,
  allowCommands: string[]
): boolean {
  const c = command.trim();
  return allowCommands.some((a) => a.trim() === c);
}

export function workspaceRootsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return (env.AGENT_WORKSPACE_ROOTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function requireWorkspaceRoots(
  roots: string[],
  env: NodeJS.ProcessEnv = process.env
): void {
  const required =
    env.NODE_ENV === 'production' ||
    env.AGENT_WORKSPACE_ROOTS_REQUIRED === '1' ||
    env.AGENT_WORKSPACE_ROOTS_REQUIRED === 'true';
  if (required && roots.length === 0) {
    throw new Error(
      'Path jail: AGENT_WORKSPACE_ROOTS must be set (comma-separated absolute roots)'
    );
  }
}

/**
 * Ensure localPath is absolute, has no `..`, and (if roots provided / required)
 * sits under one of them.
 */
export function assertPathJail(
  localPath: string,
  roots: string[] = []
): string {
  if (!path.isAbsolute(localPath)) {
    throw new Error('Path jail: workspace path must be absolute');
  }
  if (localPath.split(/[/\\]/).includes('..') || localPath.includes('..')) {
    throw new Error('Path jail: .. not allowed');
  }
  const resolved = path.resolve(localPath);
  if (roots.length) {
    const ok = roots.some((root) => {
      const r = path.resolve(root);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
    if (!ok) throw new Error('Path jail: workspace outside allowed roots');
  }
  return resolved;
}

/**
 * Devices may only shrink the allowlist on heartbeat (cannot add new commands).
 * Empty server list allows a one-time bootstrap from the device.
 */
export function mergeAllowCommands(
  existing: string[],
  proposed: string[] | undefined
): string[] {
  const current = (existing || []).map((c) => c.trim()).filter(Boolean);
  if (!proposed) return current;
  const next = proposed.map((c) => String(c).trim()).filter(Boolean);
  if (!current.length) return next;
  const allowed = new Set(current);
  return next.filter((c) => allowed.has(c));
}

/** Split allowlisted command into argv (no shell). */
export function commandToArgv(command: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of command.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}
