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

export function isCommandAllowed(
  command: string,
  allowCommands: string[]
): boolean {
  const c = command.trim();
  return allowCommands.some((a) => a.trim() === c);
}

export function assertPathJail(localPath: string, roots: string[] = []): string {
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
