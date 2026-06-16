/**
 * Safe formula evaluator for calculated custom fields.
 * Syntax: {fieldKey} references, numbers, + - * / ( ), functions:
 *   daysBetween({a},{b}), coalesce({a},{b},0), round(x)
 */

const ALLOWED_ISSUE_KEYS = new Set([
  'storyPoints',
  'timeEstimateMinutes',
  'title',
  'status',
  'type',
  'priority',
]);

function toNumber(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(v);
    if (!Number.isNaN(d)) return d / 86400000;
  }
  return 0;
}

function parseDayMs(v: unknown): number | null {
  if (v == null || v === '') return null;
  const d = new Date(String(v).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

function daysBetween(a: unknown, b: unknown): number {
  const msA = parseDayMs(a);
  const msB = parseDayMs(b);
  if (msA == null || msB == null) return 0;
  return Math.max(0, Math.round(Math.abs(msB - msA) / 86400000));
}

function buildContext(issue: Record<string, unknown>): Record<string, number> {
  const ctx: Record<string, number> = {};
  for (const key of ALLOWED_ISSUE_KEYS) {
    if (issue[key] !== undefined) ctx[key] = toNumber(issue[key]);
  }
  if (issue.startDate !== undefined) ctx.startDate = toNumber(issue.startDate);
  if (issue.dueDate !== undefined) ctx.dueDate = toNumber(issue.dueDate);
  const cfv = issue.customFieldValues as Record<string, unknown> | undefined;
  if (cfv && typeof cfv === 'object') {
    for (const [k, v] of Object.entries(cfv)) {
      if (!k.startsWith('_')) ctx[k] = toNumber(v);
    }
  }
  return ctx;
}

function substituteRefs(expr: string, ctx: Record<string, number>): string {
  return expr.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, key: string) => {
    const v = ctx[key];
    return v !== undefined ? String(v) : '0';
  });
}

function expandFunctions(expr: string, rawIssue: Record<string, unknown>): string {
  let out = expr;
  const cfv = (rawIssue.customFieldValues ?? {}) as Record<string, unknown>;

  const resolveRef = (ref: string): unknown => {
    const k = ref.replace(/[{}]/g, '');
    if (ALLOWED_ISSUE_KEYS.has(k) && rawIssue[k] !== undefined) return rawIssue[k];
    if (k === 'startDate') return rawIssue.startDate;
    if (k === 'dueDate') return rawIssue.dueDate;
    return cfv[k];
  };

  out = out.replace(/daysBetween\s*\(\s*(\{[^}]+\})\s*,\s*(\{[^}]+\})\s*\)/gi, (_, a: string, b: string) => {
    return String(daysBetween(resolveRef(a), resolveRef(b)));
  });

  out = out.replace(/coalesce\s*\(\s*(\{[^}]+\})\s*,\s*(\{[^}]+\})\s*\)/gi, (_, a: string, b: string) => {
    const va = resolveRef(a);
    const vb = resolveRef(b);
    const pick = va != null && va !== '' ? va : vb;
    return String(toNumber(pick));
  });

  out = out.replace(/round\s*\(\s*([^)]+)\s*\)/gi, (_, inner: string) => {
    return String(Math.round(Number(inner) || 0));
  });

  return out;
}

/** Evaluate a numeric formula; returns null if invalid or empty. */
export function evaluateFormula(
  formula: string | undefined,
  issue: Record<string, unknown>
): number | null {
  if (!formula?.trim()) return null;
  const ctx = buildContext(issue);
  let expr = expandFunctions(formula.trim(), issue);
  expr = substituteRefs(expr, ctx);
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`return (${expr})`);
    const result = fn();
    if (typeof result === 'number' && Number.isFinite(result)) return Math.round(result * 1000) / 1000;
    return null;
  } catch {
    return null;
  }
}

export function enrichCalculatedCustomFields(
  customFields: Array<{ key: string; fieldType: string; formula?: string }>,
  issue: Record<string, unknown>
): Record<string, unknown> {
  const base = { ...(issue.customFieldValues as Record<string, unknown> | undefined) };
  for (const field of customFields) {
    if (field.fieldType !== 'formula' || !field.formula) continue;
    const val = evaluateFormula(field.formula, issue);
    if (val !== null) base[field.key] = val;
  }
  return base;
}
