import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CalendarEvent } from './models/calendarEvent.model';
import { CrmActivity } from '../crm/models/crmActivity.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { BillingSubscription } from '../billing/models/billingSubscription.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type UnifiedEvent = {
  id: string;
  source: 'calendar' | 'activity' | 'contract_renewal' | 'ticket_sla' | 'subscription';
  kind: string;
  title: string;
  start: Date;
  end?: Date;
  allDay: boolean;
  editable: boolean;
  link?: string;
  meta?: Record<string, unknown>;
};

// ── Manual events CRUD ──────────────────────────────────────────────────────

export async function listEvents(
  workspaceId: string | null | undefined,
  query: { kind?: string; from?: string; to?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.kind) filter.kind = query.kind;
  const from = asDate(query.from);
  const to = asDate(query.to);
  if (from || to) filter.start = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  return CalendarEvent.find(filter).populate('accountId', 'name').populate('ownerId', 'name').sort({ start: 1 }).lean();
}

export async function createEvent(workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!input.title || !String(input.title).trim()) throw new ApiError(400, 'Title is required');
  const start = asDate(input.start);
  if (!start) throw new ApiError(400, 'Start date is required');
  const doc = await CalendarEvent.create({
    taskflowOrganizationId: toOrgOid(orgId),
    title: String(input.title).trim(),
    kind: input.kind ?? 'meeting',
    start,
    end: asDate(input.end),
    allDay: Boolean(input.allDay),
    location: input.location,
    meetingUrl: input.meetingUrl,
    accountId: input.accountId || undefined,
    dealId: input.dealId || undefined,
    projectId: input.projectId || undefined,
    attendeeIds: Array.isArray(input.attendeeIds) ? input.attendeeIds : [],
    ownerId: userId || undefined,
    notes: input.notes,
  });
  return doc.toObject();
}

export async function updateEvent(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const ev = await CalendarEvent.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!ev) throw new ApiError(404, 'Event not found');
  const fields = ['title', 'kind', 'location', 'meetingUrl', 'accountId', 'dealId', 'projectId', 'notes'] as const;
  for (const key of fields) if (key in input) (ev as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('start' in input) ev.start = asDate(input.start) ?? ev.start;
  if ('end' in input) ev.end = asDate(input.end);
  if ('allDay' in input) ev.allDay = Boolean(input.allDay);
  if ('attendeeIds' in input && Array.isArray(input.attendeeIds)) ev.attendeeIds = input.attendeeIds as never;
  await ev.save();
  return ev.toObject();
}

export async function deleteEvent(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await CalendarEvent.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Event not found');
  return { deleted: true };
}

// ── Unified feed (aggregates dated items across modules) ─────────────────────

export async function getUnifiedFeed(
  workspaceId: string | null | undefined,
  query: { from?: string; to?: string } = {}
): Promise<UnifiedEvent[]> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const from = asDate(query.from) ?? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const to = asDate(query.to) ?? new Date(new Date().getFullYear(), new Date().getMonth() + 2, 0);

  const [events, activities, contracts, tickets, subscriptions] = await Promise.all([
    CalendarEvent.find({ taskflowOrganizationId: orgOid, start: { $gte: from, $lte: to } }).populate('accountId', 'name').lean(),
    CrmActivity.find({ taskflowOrganizationId: orgOid, dueAt: { $gte: from, $lte: to }, completedAt: { $exists: false } }).lean(),
    CrmContract.find({ taskflowOrganizationId: orgOid, renewalDate: { $gte: from, $lte: to }, status: 'active' }).populate('accountId', 'name').lean(),
    ServiceTicket.find({
      taskflowOrganizationId: orgOid,
      resolutionDueAt: { $gte: from, $lte: to },
      status: { $nin: ['resolved', 'closed'] },
    }).lean(),
    BillingSubscription.find({ taskflowOrganizationId: orgOid, nextBillingDate: { $gte: from, $lte: to }, status: 'active' }).populate('accountId', 'name').lean(),
  ]);

  const feed: UnifiedEvent[] = [];

  for (const e of events) {
    feed.push({
      id: `event-${e._id}`,
      source: 'calendar',
      kind: e.kind,
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      editable: true,
      meta: { account: (e.accountId as unknown as { name?: string })?.name, location: e.location, meetingUrl: e.meetingUrl },
    });
  }
  for (const a of activities) {
    feed.push({
      id: `activity-${a._id}`,
      source: 'activity',
      kind: a.type,
      title: `${a.type === 'demo' ? 'Demo' : a.type === 'meeting' ? 'Meeting' : 'Follow-up'}: ${a.subject}`,
      start: a.dueAt as Date,
      allDay: false,
      editable: false,
      link: '/crm/activities',
    });
  }
  for (const c of contracts) {
    feed.push({
      id: `contract-${c._id}`,
      source: 'contract_renewal',
      kind: 'renewal',
      title: `Renewal: ${c.title}`,
      start: c.renewalDate as Date,
      allDay: true,
      editable: false,
      link: '/contracts/renewals',
      meta: { account: (c.accountId as unknown as { name?: string })?.name, value: c.value, currency: c.currency },
    });
  }
  for (const t of tickets) {
    feed.push({
      id: `ticket-${t._id}`,
      source: 'ticket_sla',
      kind: 'sla',
      title: `SLA due: ${t.subject}`,
      start: t.resolutionDueAt as Date,
      allDay: false,
      editable: false,
      link: '/service/tickets',
      meta: { priority: t.priority },
    });
  }
  for (const s of subscriptions) {
    feed.push({
      id: `sub-${s._id}`,
      source: 'subscription',
      kind: 'billing',
      title: `Billing: ${s.name}`,
      start: s.nextBillingDate as Date,
      allDay: true,
      editable: false,
      link: '/billing/subscriptions',
      meta: { account: (s.accountId as unknown as { name?: string })?.name, amount: s.amount, currency: s.currency },
    });
  }

  return feed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

export async function getCalendarDashboard(workspaceId: string | null | undefined) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  const feed = await getUnifiedFeed(workspaceId, { from: from.toISOString(), to: to.toISOString() });

  const in7 = new Date();
  in7.setDate(in7.getDate() + 7);
  const upcoming = feed.filter((e) => new Date(e.start) >= now).slice(0, 12);

  const bySource = ['calendar', 'activity', 'contract_renewal', 'ticket_sla', 'subscription'].map((s) => ({
    name: s.replace('_', ' '),
    value: feed.filter((e) => e.source === s).length,
  }));

  // events per day for next 14 days
  const byDay: { day: string; count: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    byDay.push({
      day: key.slice(5),
      count: feed.filter((e) => new Date(e.start).toISOString().slice(0, 10) === key).length,
    });
  }

  return {
    counts: {
      total: feed.length,
      thisWeek: feed.filter((e) => new Date(e.start) >= now && new Date(e.start) <= in7).length,
      meetings: feed.filter((e) => e.source === 'calendar').length,
      renewals: feed.filter((e) => e.source === 'contract_renewal').length,
      slaDue: feed.filter((e) => e.source === 'ticket_sla').length,
    },
    bySource,
    byDay,
    upcoming,
  };
}
