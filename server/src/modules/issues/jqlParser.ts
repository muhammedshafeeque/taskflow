/**
 * Simple JQL parser for issue queries.
 * Supports: project, status, assignee, type, priority, sprint, labels, text
 * Operators: =, in (...), ~ (text search)
 * Logic: AND, OR
 * Order: order by field ASC/DESC
 */

export interface JqlOrder {
  field: string;
  direction: 1 | -1;
}

export interface JqlParseResult {
  filter: Record<string, unknown>;
  order?: JqlOrder;
}

const FIELD_MAP: Record<string, string> = {
  project: 'project',
  status: 'status',
  assignee: 'assignee',
  type: 'type',
  priority: 'priority',
  sprint: 'sprint',
  labels: 'labels',
  key: 'key',
  created: 'createdAt',
  updated: 'updatedAt',
};

function toMongoField(field: string): string {
  return FIELD_MAP[field.toLowerCase()] ?? field;
}

function parseValueList(tokens: string[], i: number): { values: string[]; end: number } {
  const values: string[] = [];
  let idx = i;
  if (tokens[idx] !== '(') return { values: [], end: idx };
  idx++;
  while (idx < tokens.length && tokens[idx] !== ')') {
    const v = tokens[idx];
    if (v === ',') {
      idx++;
      continue;
    }
    values.push(v.replace(/^["']|["']$/g, ''));
    idx++;
  }
  if (idx < tokens.length && tokens[idx] === ')') idx++;
  return { values, end: idx };
}

function tokenize(jql: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const s = jql.trim();
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    if (s[i] === '(' || s[i] === ')' || s[i] === ',' || s[i] === '=') {
      tokens.push(s[i]);
      i++;
      continue;
    }
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      let val = '';
      while (i < s.length && s[i] !== quote) {
        if (s[i] === '\\') {
          i++;
          if (i < s.length) val += s[i++];
        } else val += s[i++];
      }
      if (i < s.length) i++;
      tokens.push(quote + val + quote);
      continue;
    }
    if (/[a-zA-Z_~]/.test(s[i])) {
      let word = '';
      // Hyphens join word parts, so issue keys like APP-12 stay one token.
      while (i < s.length && (/[a-zA-Z0-9_.~]/.test(s[i]) || (s[i] === '-' && /[a-zA-Z0-9]/.test(s[i + 1] ?? '')))) {
        word += s[i++];
      }
      tokens.push(word);
      continue;
    }
    i++;
  }
  return tokens;
}

function parseCondition(tokens: string[], i: number): { filter: Record<string, unknown>; end: number } | null {
  if (i >= tokens.length) return null;
  const field = tokens[i].toLowerCase();
  const mongoField = toMongoField(field);
  if (i + 2 > tokens.length) return null;

  const op = tokens[i + 1].toLowerCase();
  let idx = i + 2;

  if (op === '=') {
    const val = tokens[idx];
    const strVal = val?.replace(/^["']|["']$/g, '') ?? '';
    if (field === 'assignee' && (strVal.toLowerCase() === 'me' || strVal.toLowerCase() === 'currentuser()')) {
      return { filter: { __assigneeMe: true }, end: idx + 1 };
    }
    if (field === 'project' && strVal) {
      return { filter: { project: strVal }, end: idx + 1 };
    }
    if (field === 'sprint' && (strVal.toLowerCase() === 'null' || strVal.toLowerCase() === 'backlog' || strVal === '')) {
      return { filter: { sprint: null }, end: idx + 1 };
    }
    if (field === 'sprint' && strVal) {
      return { filter: { sprint: strVal }, end: idx + 1 };
    }
    return { filter: { [mongoField]: strVal }, end: idx + 1 };
  }

  if (op === 'in' && idx < tokens.length && tokens[idx] === '(') {
    const { values, end } = parseValueList(tokens, idx);
    if (field === 'labels') {
      return { filter: { labels: { $in: values } }, end };
    }
    return { filter: { [mongoField]: { $in: values } }, end };
  }

  if (op === 'not') {
    const next = tokens[idx]?.toLowerCase();
    if (next === 'in' && idx + 1 < tokens.length && tokens[idx + 1] === '(') {
      const { values, end } = parseValueList(tokens, idx + 1);
      if (field === 'labels') {
        return { filter: { labels: { $nin: values } }, end };
      }
      return { filter: { [mongoField]: { $nin: values } }, end };
    }
    const val = tokens[idx];
    const strVal = val?.replace(/^["']|["']$/g, '') ?? '';
    if (field === 'assignee' && (strVal.toLowerCase() === 'me' || strVal.toLowerCase() === 'currentuser()')) {
      return { filter: { __assigneeNotMe: true }, end: idx + 1 };
    }
    if (field === 'sprint' && (strVal.toLowerCase() === 'null' || strVal.toLowerCase() === 'backlog' || strVal === '')) {
      return { filter: { sprint: { $ne: null } }, end: idx + 1 };
    }
    return { filter: { [mongoField]: { $ne: strVal } }, end: idx + 1 };
  }

  if (op === '~' || field === 'text') {
    const val = tokens[field === 'text' ? idx - 1 : idx];
    const strVal = (val ?? '').replace(/^["']|["']$/g, '');
    const regex = new RegExp(strVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return {
      filter: {
        $or: [
          { title: regex },
          { description: regex },
          { key: regex },
        ],
      },
      end: field === 'text' ? idx : idx + 1,
    };
  }

  return null;
}

function parseAndOr(tokens: string[], start: number): { filter: Record<string, unknown>; end: number; order?: JqlOrder } | null {
  const andParts: Record<string, unknown>[][] = [];
  let currentAnd: Record<string, unknown>[] = [];
  let idx = start;
  let order: JqlOrder | undefined;

  const flush = () => {
    if (currentAnd.length > 0) {
      andParts.push(currentAnd);
      currentAnd = [];
    }
  };

  while (idx < tokens.length) {
    const t = tokens[idx].toLowerCase();
    if (t === 'order' && tokens[idx + 1]?.toLowerCase() === 'by') {
      flush();
      idx += 2;
      const orderField = tokens[idx]?.toLowerCase() ?? 'created';
      const dir = tokens[idx + 1]?.toLowerCase();
      order = {
        field: toMongoField(orderField),
        direction: dir === 'asc' ? 1 : -1,
      };
      idx += 2;
      break;
    }
    if (t === 'or') {
      flush();
      idx++;
      continue;
    }
    if (t === 'and') {
      idx++;
      continue;
    }
    const cond = parseCondition(tokens, idx);
    if (cond) {
      currentAnd.push(cond.filter);
      idx = cond.end;
    } else {
      idx++;
    }
  }
  flush();

  if (andParts.length === 0) return null;

  let filter: Record<string, unknown>;
  if (andParts.length === 1 && andParts[0].length === 1) {
    filter = andParts[0][0];
  } else if (andParts.length === 1) {
    filter = { $and: andParts[0] };
  } else {
    filter = { $or: andParts.map((p) => (p.length === 1 ? p[0] : { $and: p })) };
  }

  return { filter, end: idx, order };
}

export function parseJql(jql: string, userId?: string): JqlParseResult {
  if (!jql || !jql.trim()) {
    return { filter: {} };
  }

  const tokens = tokenize(jql);
  const result = parseAndOr(tokens, 0);
  if (!result) return { filter: {} };

  let filter = result.filter as Record<string, unknown>;

  if (filter.__assigneeMe && userId) {
    delete filter.__assigneeMe;
    filter.assignee = userId;
  }
  if (filter.__assigneeNotMe && userId) {
    delete filter.__assigneeNotMe;
    filter.assignee = { $ne: userId };
  }

  return {
    filter,
    order: result.order,
  };
}
