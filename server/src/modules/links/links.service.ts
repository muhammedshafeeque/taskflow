/**
 * Record graph: explicit links between any two records plus the references the
 * records already carry (deal → project, quote → deal, ticket → issue, …).
 * Every record returned is checked against the viewer: module on, a read
 * permission for its type, and project membership for projects and issues.
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { hasProjectFullAccess } from '../../middleware/requireProjectPermission';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import { getPlatformEnabledModules } from '../core/core.service';
import { isModuleEnabled } from '../../shared/constants/moduleAccess';
import { escapeRegex } from '../../utils/safeUrl';
import { logAudit } from '../auditLogs/logAudit';
import { RecordLink } from './recordLink.model';
import { RECORD_TYPES, RECORD_TYPE_DEFS, isRecordType, type RecordType } from './recordTypes';

export type RecordRef = { type: RecordType; id: string };

export type RecordSummary = {
  type: RecordType;
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  link: string;
};

export type GraphEdge = {
  /** Set for explicit links — the id to delete. Field links come from the record itself. */
  linkId?: string;
  source: 'link' | 'field';
  relation: string;
  /** "out": this record points at the other one; "in": the other one points here. */
  direction: 'out' | 'in';
  note?: string;
  record: RecordSummary;
};

export type Viewer = { userId: string; permissions: string[] };

const INVERSE_LIMIT = 20;
const LINK_LIMIT = 200;

/** What one viewer may see in one workspace, resolved once per request. */
export class GraphAccess {
  private projectIds?: Promise<Set<string> | 'all'>;
  private modules?: ReturnType<typeof getPlatformEnabledModules>;

  constructor(
    readonly orgOid: mongoose.Types.ObjectId,
    readonly viewer: Viewer
  ) {}

  static for(workspaceId: string | null | undefined, viewer: Viewer): GraphAccess {
    return new GraphAccess(toOrgOid(requireWorkspaceId(workspaceId)), viewer);
  }

  async canSeeType(type: RecordType): Promise<boolean> {
    const def = RECORD_TYPE_DEFS[type];
    this.modules ??= getPlatformEnabledModules();
    if (!isModuleEnabled(def.module, await this.modules)) return false;
    if (!def.permissions.length) return true;
    return def.permissions.some((p) => userHasPermission(this.viewer.permissions, p));
  }

  /** Projects this viewer may open: all in the workspace for project admins, else memberships. */
  visibleProjects(): Promise<Set<string> | 'all'> {
    this.projectIds ??= (async () => {
      const perms = this.viewer.permissions;
      if (hasProjectFullAccess(perms) || userHasPermission(perms, TASK_FLOW_PERMISSIONS.TASKFLOW.PROJECT.LIST_ALL)) {
        return 'all' as const;
      }
      const ids = await ProjectMember.find({ user: new mongoose.Types.ObjectId(this.viewer.userId) }).distinct('project');
      return new Set(ids.map(String));
    })();
    return this.projectIds;
  }

  async canSeeProject(projectId: unknown): Promise<boolean> {
    const visible = await this.visibleProjects();
    return visible === 'all' || visible.has(String(projectId));
  }
}

type Doc = Record<string, unknown> & { _id: unknown };

function summarize(type: RecordType, d: Doc): RecordSummary {
  const def = RECORD_TYPE_DEFS[type];
  return {
    type,
    id: String(d._id),
    title: def.title(d),
    subtitle: def.subtitle(d),
    status: def.status(d),
    link: def.link(d),
  };
}

function toOids(ids: string[]): mongoose.Types.ObjectId[] {
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id)).map((id) => new mongoose.Types.ObjectId(id));
}

type Loaded = {
  visible: Map<string, Doc>;
  /** Ids that exist in the workspace, or null when the type could not be looked up. */
  existing: Set<string> | null;
};

/** Load records of one type, keeping only those in the workspace that the viewer may see. */
async function loadVisible(access: GraphAccess, type: RecordType, ids: string[]): Promise<Map<string, Doc>> {
  return (await loadRecords(access, type, ids)).visible;
}

async function loadRecords(access: GraphAccess, type: RecordType, ids: string[]): Promise<Loaded> {
  const out = new Map<string, Doc>();
  const oids = toOids([...new Set(ids)]);
  if (!oids.length) return { visible: out, existing: new Set() };
  if (!(await access.canSeeType(type))) return { visible: out, existing: null };
  const def = RECORD_TYPE_DEFS[type];
  const filter: Record<string, unknown> = { _id: { $in: oids } };
  if (def.orgScoped) filter.taskflowOrganizationId = access.orgOid;
  const rows = (await def.model.find(filter).select(def.select).lean()) as Doc[];
  const existing = new Set<string>();
  for (const row of rows) {
    const id = String(row._id);
    existing.add(id);
    if (await isVisibleRow(access, type, row)) out.set(id, row);
  }
  return { visible: out, existing };
}

async function isVisibleRow(access: GraphAccess, type: RecordType, row: Doc): Promise<boolean> {
  if (type === 'project') return access.canSeeProject(row._id);
  if (type === 'issue') {
    if (!(await access.canSeeProject(row.project))) return false;
    // Issues carry no workspace id — confirm through their project.
    return Boolean(await Project.exists({ _id: row.project, taskflowOrganizationId: access.orgOid }));
  }
  return true;
}

export async function getRecord(access: GraphAccess, ref: RecordRef): Promise<Doc> {
  const found = await loadVisible(access, ref.type, [ref.id]);
  const row = found.get(ref.id);
  if (!row) throw new ApiError(404, `${RECORD_TYPE_DEFS[ref.type].label} not found`);
  return row;
}

function refValues(row: Doc, field: string): string[] {
  const v = row[field];
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(String);
}

/** One record and everything linked to it, explicit and implied, that the viewer may see. */
export async function getGraph(
  access: GraphAccess,
  ref: RecordRef
): Promise<{ record: RecordSummary; edges: GraphEdge[]; hidden: number }> {
  const row = await getRecord(access, ref);
  const def = RECORD_TYPE_DEFS[ref.type];
  const oid = new mongoose.Types.ObjectId(ref.id);

  type Pending = Omit<GraphEdge, 'record'> & { type: RecordType; id: string };
  const pending: Pending[] = [];

  // 1. References this record holds.
  for (const r of def.refs) {
    for (const id of refValues(row, r.field)) {
      pending.push({ source: 'field', relation: r.label, direction: 'out', type: r.to, id });
    }
  }

  // 2. Records of other types whose reference fields point here.
  const inverse = RECORD_TYPES.flatMap((t) =>
    RECORD_TYPE_DEFS[t].refs.filter((r) => r.to === ref.type && r.inverse).map((r) => ({ type: t, ref: r }))
  );
  const inverseRows = await Promise.all(
    inverse.map(async ({ type, ref: r }) => {
      if (!(await access.canSeeType(type))) return [];
      const other = RECORD_TYPE_DEFS[type];
      const filter: Record<string, unknown> = { [r.field]: oid };
      if (other.orgScoped) filter.taskflowOrganizationId = access.orgOid;
      const rows = (await other.model.find(filter).select('_id').sort({ updatedAt: -1 }).limit(INVERSE_LIMIT).lean()) as Doc[];
      return rows.map((d) => ({ type, id: String(d._id), label: r.label }));
    })
  );
  for (const list of inverseRows) {
    for (const hit of list) {
      if (hit.type === ref.type && hit.id === ref.id) continue;
      pending.push({ source: 'field', relation: hit.label, direction: 'in', type: hit.type, id: hit.id });
    }
  }

  // 3. Explicit links, either direction.
  const links = await RecordLink.find({
    taskflowOrganizationId: access.orgOid,
    $or: [
      { fromType: ref.type, fromId: oid },
      { toType: ref.type, toId: oid },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(LINK_LIMIT)
    .lean();
  for (const l of links) {
    const out = l.fromType === ref.type && String(l.fromId) === ref.id;
    pending.push({
      linkId: String(l._id),
      source: 'link',
      relation: l.relation,
      direction: out ? 'out' : 'in',
      note: l.note,
      type: out ? l.toType : l.fromType,
      id: String(out ? l.toId : l.fromId),
    });
  }

  // Resolve titles in one query per type and drop what the viewer may not see.
  const byType = new Map<RecordType, string[]>();
  for (const p of pending) byType.set(p.type, [...(byType.get(p.type) ?? []), p.id]);
  const loaded = new Map<string, Doc>();
  const gone = new Set<string>();
  await Promise.all(
    [...byType].map(async ([type, ids]) => {
      const { visible, existing } = await loadRecords(access, type, ids);
      for (const [id, d] of visible) loaded.set(`${type}:${id}`, d);
      // Deleted records leave stale links behind; skip them rather than count them as hidden.
      if (existing) for (const id of ids) if (!existing.has(id)) gone.add(`${type}:${id}`);
    })
  );

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  let hidden = 0;
  for (const p of pending) {
    const d = loaded.get(`${p.type}:${p.id}`);
    if (gone.has(`${p.type}:${p.id}`)) continue;
    if (!d) {
      hidden += 1;
      continue;
    }
    // An explicit link that repeats a field link adds nothing; keep the first.
    const key = `${p.source}:${p.linkId ?? ''}:${p.type}:${p.id}:${p.relation}:${p.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { type, id: _id, ...edge } = p;
    edges.push({ ...edge, record: summarize(type, d) });
  }

  return { record: summarize(ref.type, row), edges, hidden };
}

/** Types the viewer may link to, for the picker. */
export async function visibleTypes(access: GraphAccess): Promise<Array<{ type: RecordType; label: string }>> {
  const out: Array<{ type: RecordType; label: string }> = [];
  for (const type of RECORD_TYPES) {
    if (await access.canSeeType(type)) out.push({ type, label: RECORD_TYPE_DEFS[type].label });
  }
  return out;
}

/** Picker search within one type. */
export async function searchRecords(access: GraphAccess, type: RecordType, rawQuery: string): Promise<RecordSummary[]> {
  if (!(await access.canSeeType(type))) return [];
  const def = RECORD_TYPE_DEFS[type];
  const q = String(rawQuery || '').trim().slice(0, 100);
  const filter: Record<string, unknown> = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = def.searchFields.map((f) => ({ [f]: rx }));
  }
  if (def.orgScoped) filter.taskflowOrganizationId = access.orgOid;

  if (type === 'project' || type === 'issue') {
    const visible = await access.visibleProjects();
    const inOrg = await Project.find({
      taskflowOrganizationId: access.orgOid,
      ...(visible === 'all' ? {} : { _id: { $in: toOids([...visible]) } }),
    }).distinct('_id');
    if (type === 'project') filter._id = { $in: inOrg };
    else filter.project = { $in: inOrg };
  }

  const rows = (await def.model.find(filter).select(def.select).sort({ updatedAt: -1 }).limit(10).lean()) as Doc[];
  return rows.map((d) => summarize(type, d));
}

function parseRef(raw: unknown, label: string): RecordRef {
  const r = (raw ?? {}) as { type?: unknown; id?: unknown };
  if (!isRecordType(r.type)) throw new ApiError(400, `${label}.type is not a linkable record type`);
  const id = String(r.id ?? '');
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, `${label}.id is invalid`);
  return { type: r.type, id };
}

/** Anyone who can open both records may link them. */
export async function createLink(
  access: GraphAccess,
  body: { from?: unknown; to?: unknown; relation?: unknown; note?: unknown }
): Promise<GraphEdge> {
  const from = parseRef(body.from, 'from');
  const to = parseRef(body.to, 'to');
  if (from.type === to.type && from.id === to.id) throw new ApiError(400, 'A record cannot link to itself');
  const relation = String(body.relation ?? 'related').trim().slice(0, 40) || 'related';
  const note = body.note != null ? String(body.note).trim().slice(0, 500) || undefined : undefined;

  const [, target] = await Promise.all([getRecord(access, from), getRecord(access, to)]);

  const existing = await RecordLink.findOne({
    taskflowOrganizationId: access.orgOid,
    $or: [
      { fromType: from.type, fromId: from.id, toType: to.type, toId: to.id, relation },
      { fromType: to.type, fromId: to.id, toType: from.type, toId: from.id, relation },
    ],
  }).lean();
  if (existing) throw new ApiError(409, 'These records are already linked that way');

  const link = await RecordLink.create({
    taskflowOrganizationId: access.orgOid,
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    relation,
    note,
    createdBy: access.viewer.userId,
  });
  logAudit({
    userId: access.viewer.userId,
    action: 'create',
    resourceType: 'record_link',
    resourceId: String(link._id),
    meta: { from, to, relation },
  });
  return {
    linkId: String(link._id),
    source: 'link',
    relation,
    direction: 'out',
    note,
    record: summarize(to.type, target),
  };
}

/** Removing a link needs the same access as adding it: both ends visible. */
export async function deleteLink(access: GraphAccess, linkId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(linkId)) throw new ApiError(400, 'Invalid link id');
  const link = await RecordLink.findOne({ _id: linkId, taskflowOrganizationId: access.orgOid }).lean();
  if (!link) throw new ApiError(404, 'Link not found');
  await Promise.all([
    getRecord(access, { type: link.fromType, id: String(link.fromId) }),
    getRecord(access, { type: link.toType, id: String(link.toId) }),
  ]);
  await RecordLink.deleteOne({ _id: link._id });
  logAudit({
    userId: access.viewer.userId,
    action: 'delete',
    resourceType: 'record_link',
    resourceId: linkId,
    meta: {
      from: { type: link.fromType, id: String(link.fromId) },
      to: { type: link.toType, id: String(link.toId) },
      relation: link.relation,
    },
  });
}
