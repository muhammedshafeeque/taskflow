import { CrmAccount } from '../models/crmAccount.model';
import { CrmContact } from '../models/crmContact.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmContract } from '../models/crmContract.model';
import { CrmQuote } from '../models/crmQuote.model';
import { CrmPipeline } from '../models/crmPipeline.model';
import { ServiceTicket } from '../../service-desk/models/serviceTicket.model';
import { User } from '../../auth/user.model';
import { CoreCompanySettings } from '../../core/models/coreCompanySettings.model';
import { requireWorkspaceId, toOrgOid } from '../crmWorkspace';
import { ensureDefaultPipeline } from '../pipelines/pipelines.service';

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(monthKey(d));
  }
  return out;
}

export async function getCrmDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  await ensureDefaultPipeline(orgId);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    accounts,
    contacts,
    leads,
    openDeals,
    allDeals,
    activities,
    openTickets,
    contracts,
    quotes,
    pipelines,
    leadsAgg,
    activitiesAgg,
    quotesAgg,
    closedRecent,
  ] = await Promise.all([
    CrmAccount.countDocuments({ taskflowOrganizationId: orgOid }),
    CrmContact.countDocuments({ taskflowOrganizationId: orgOid }),
    CrmLead.countDocuments({ taskflowOrganizationId: orgOid, status: { $ne: 'converted' } }),
    CrmDeal.find({ taskflowOrganizationId: orgOid, status: 'open' }).lean(),
    CrmDeal.find({ taskflowOrganizationId: orgOid }).select('status value probability stageId expectedCloseDate').lean(),
    CrmActivity.find({ taskflowOrganizationId: orgOid }).sort({ createdAt: -1 }).limit(12).lean(),
    ServiceTicket.countDocuments({
      taskflowOrganizationId: orgOid,
      status: { $in: ['open', 'pending', 'in_progress'] },
    }),
    CrmContract.find({ taskflowOrganizationId: orgOid }).select('status value').lean(),
    CrmQuote.find({ taskflowOrganizationId: orgOid }).select('status subtotal').lean(),
    CrmPipeline.find({ taskflowOrganizationId: orgOid }).lean(),
    CrmLead.aggregate([
      { $match: { taskflowOrganizationId: orgOid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CrmActivity.aggregate([
      { $match: { taskflowOrganizationId: orgOid } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    CrmQuote.aggregate([
      { $match: { taskflowOrganizationId: orgOid } },
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$subtotal' } } },
    ]),
    CrmDeal.find({
      taskflowOrganizationId: orgOid,
      status: { $in: ['won', 'lost'] },
      updatedAt: { $gte: sixMonthsAgo },
    })
      .select('status value updatedAt')
      .lean(),
  ]);

  const pipelineValue = openDeals.reduce((s, d) => s + (d.value ?? 0), 0);
  const weightedPipeline = openDeals.reduce(
    (s, d) => s + (d.value ?? 0) * ((d.probability ?? 0) / 100),
    0
  );
  const wonValue = allDeals.filter((d) => d.status === 'won').reduce((s, d) => s + (d.value ?? 0), 0);
  const lostValue = allDeals.filter((d) => d.status === 'lost').reduce((s, d) => s + (d.value ?? 0), 0);
  const wonCount = allDeals.filter((d) => d.status === 'won').length;
  const lostCount = allDeals.filter((d) => d.status === 'lost').length;
  const winRate = wonCount + lostCount > 0 ? Math.round((wonCount / (wonCount + lostCount)) * 1000) / 10 : 0;

  const dealsByStatus = [
    { name: 'Open', count: openDeals.length, value: pipelineValue },
    { name: 'Won', count: wonCount, value: wonValue },
    { name: 'Lost', count: lostCount, value: lostValue },
  ];

  const stageMap = new Map<string, { name: string; order: number }>();
  for (const p of pipelines) {
    for (const st of p.stages ?? []) {
      stageMap.set(String(st._id), { name: st.name, order: st.order ?? 0 });
    }
  }

  const stageBucket = new Map<string, { name: string; order: number; count: number; value: number }>();
  for (const d of openDeals) {
    const sid = String(d.stageId);
    const meta = stageMap.get(sid) ?? { name: 'Unknown', order: 999 };
    const cur = stageBucket.get(sid) ?? { name: meta.name, order: meta.order, count: 0, value: 0 };
    cur.count += 1;
    cur.value += d.value ?? 0;
    stageBucket.set(sid, cur);
  }
  const dealsByStage = [...stageBucket.values()].sort((a, b) => a.order - b.order);

  const forecastByMonth: Record<string, { weighted: number; total: number; count: number }> = {};
  for (const d of openDeals) {
    const month = d.expectedCloseDate ? monthKey(new Date(d.expectedCloseDate)) : 'unscheduled';
    if (!forecastByMonth[month]) forecastByMonth[month] = { weighted: 0, total: 0, count: 0 };
    forecastByMonth[month].total += d.value ?? 0;
    forecastByMonth[month].weighted += (d.value ?? 0) * ((d.probability ?? 0) / 100);
    forecastByMonth[month].count += 1;
  }
  const forecastSeries = Object.entries(forecastByMonth)
    .filter(([m]) => m !== 'unscheduled')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, row]) => ({
      month,
      weighted: Math.round(row.weighted),
      total: Math.round(row.total),
      count: row.count,
    }));
  const unscheduledForecast = forecastByMonth.unscheduled ?? { weighted: 0, total: 0, count: 0 };

  const months = lastNMonths(6);
  const closedTrendMap = new Map(months.map((m) => [m, { month: m, won: 0, lost: 0, wonValue: 0, lostValue: 0 }]));
  for (const d of closedRecent) {
    const m = monthKey(new Date((d as { updatedAt: Date }).updatedAt));
    const row = closedTrendMap.get(m);
    if (!row) continue;
    if (d.status === 'won') {
      row.won += 1;
      row.wonValue += d.value ?? 0;
    } else {
      row.lost += 1;
      row.lostValue += d.value ?? 0;
    }
  }
  const closedTrend = months.map((m) => closedTrendMap.get(m)!);

  const leadsByStatus = leadsAgg
    .map((r) => ({ name: String(r._id ?? 'unknown'), count: r.count as number }))
    .sort((a, b) => b.count - a.count);

  const activitiesByType = activitiesAgg
    .map((r) => ({ name: String(r._id ?? 'other'), count: r.count as number }))
    .sort((a, b) => b.count - a.count);

  const quotesByStatus = quotesAgg.map((r) => ({
    name: String(r._id ?? 'unknown'),
    count: r.count as number,
    value: Math.round((r.value as number) ?? 0),
  }));

  const contractsByStatus = ['draft', 'active', 'expired', 'cancelled'].map((status) => ({
    name: status,
    count: contracts.filter((c) => c.status === status).length,
    value: contracts.filter((c) => c.status === status).reduce((s, c) => s + (c.value ?? 0), 0),
  }));

  const activeContractValue = contracts
    .filter((c) => c.status === 'active')
    .reduce((s, c) => s + (c.value ?? 0), 0);

  return {
    counts: {
      accounts,
      contacts,
      leads,
      openDeals: openDeals.length,
      openTickets,
      quotes: quotes.length,
      contracts: contracts.length,
      wonDeals: wonCount,
    },
    pipelineValue,
    weightedPipeline: Math.round(weightedPipeline),
    wonValue,
    winRate,
    activeContractValue,
    dealsByStatus,
    dealsByStage,
    leadsByStatus,
    activitiesByType,
    quotesByStatus,
    contractsByStatus,
    forecastSeries,
    unscheduledForecast: {
      weighted: Math.round(unscheduledForecast.weighted),
      total: Math.round(unscheduledForecast.total),
      count: unscheduledForecast.count,
    },
    closedTrend,
    recentActivities: activities,
    currency: (await CoreCompanySettings.findOne({ taskflowOrganizationId: orgOid }).select('baseCurrencyCode').lean())
      ?.baseCurrencyCode ?? 'USD',
    insights: await getCrmInsights(orgOid, stageMap),
  };
}

const DAY = 86_400_000;
const STALE_DEAL_DAYS = 14;
const LEAD_CLOSED_STATUSES = ['converted', 'unqualified'];

type OrgOid = ReturnType<typeof toOrgOid>;
type Ref = { _id: unknown } & Record<string, unknown>;

const idOf = (v: unknown) => (v ? String(v) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (num: number, den: number) => (den > 0 ? round1((num / den) * 100) : 0);

/**
 * Actionable CRM insights: month-over-month momentum, sales velocity, things needing attention,
 * lead source conversion, owner leaderboard and loss reasons.
 * Closed date for won/lost deals is `updatedAt` (same convention as `closedTrend`).
 */
async function getCrmInsights(orgOid: OrgOid, stageMap: Map<string, { name: string; order: number }>) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yearAgo = new Date(now.getTime() - 365 * DAY);
  const staleBefore = new Date(now.getTime() - STALE_DEAL_DAYS * DAY);
  const in14 = new Date(now.getTime() + 14 * DAY);
  const in60 = new Date(now.getTime() + 60 * DAY);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const leadOpen = { status: { $nin: LEAD_CLOSED_STATUSES } };

  const [
    openDeals,
    closedYear,
    leadsRecent,
    leadSourcesAgg,
    overdueActivities,
    overdueActivityCount,
    overdueFollowUps,
    overdueFollowUpCount,
    expiringQuotes,
    quoteOutcomes,
    renewals,
    activityRecent,
  ] = await Promise.all([
    CrmDeal.find({ taskflowOrganizationId: orgOid, status: 'open' })
      .select('title value currency probability stageId expectedCloseDate ownerId accountId createdAt updatedAt')
      .lean(),
    CrmDeal.find({ taskflowOrganizationId: orgOid, status: { $in: ['won', 'lost'] }, updatedAt: { $gte: yearAgo } })
      .select('status value ownerId lossReason createdAt updatedAt')
      .lean(),
    CrmLead.find({ taskflowOrganizationId: orgOid, createdAt: { $gte: sixMonthsAgo } })
      .select('status createdAt')
      .lean(),
    CrmLead.aggregate([
      { $match: { taskflowOrganizationId: orgOid } },
      {
        $group: {
          _id: { $ifNull: ['$source', 'unknown'] },
          total: { $sum: 1 },
          converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
          lost: { $sum: { $cond: [{ $eq: ['$status', 'unqualified'] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 8 },
    ]),
    CrmActivity.find({ taskflowOrganizationId: orgOid, dueAt: { $lt: now }, completedAt: null })
      .sort({ dueAt: 1 })
      .limit(6)
      .select('type subject dueAt relatedType relatedId assigneeId')
      .lean(),
    CrmActivity.countDocuments({ taskflowOrganizationId: orgOid, dueAt: { $lt: now }, completedAt: null }),
    CrmLead.find({ taskflowOrganizationId: orgOid, ...leadOpen, nextFollowUpAt: { $lt: now } })
      .sort({ nextFollowUpAt: 1 })
      .limit(6)
      .select('title companyName nextFollowUpAt assigneeId status')
      .lean(),
    CrmLead.countDocuments({ taskflowOrganizationId: orgOid, ...leadOpen, nextFollowUpAt: { $lt: now } }),
    CrmQuote.find({ taskflowOrganizationId: orgOid, status: 'sent', validUntil: { $gte: now, $lte: in14 } })
      .sort({ validUntil: 1 })
      .limit(6)
      .select('title total currency validUntil')
      .lean(),
    CrmQuote.aggregate([
      { $match: { taskflowOrganizationId: orgOid, status: { $in: ['accepted', 'rejected', 'expired'] } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    CrmContract.find({
      taskflowOrganizationId: orgOid,
      status: 'active',
      $or: [{ renewalDate: { $gte: now, $lte: in60 } }, { renewalDate: null, endDate: { $gte: now, $lte: in60 } }],
    })
      .select('title value currency renewalDate endDate autoRenew accountId')
      .lean(),
    CrmActivity.find({ taskflowOrganizationId: orgOid, createdAt: { $gte: new Date(now.getTime() - 60 * DAY) } })
      .select('createdAt')
      .lean(),
  ]);

  // ── Names for owners / accounts referenced below ──
  const userIds = new Set<string>();
  const accountIds = new Set<string>();
  for (const d of [...openDeals, ...closedYear]) {
    const o = idOf((d as Ref).ownerId);
    if (o) userIds.add(o);
  }
  for (const d of openDeals) {
    const a = idOf(d.accountId);
    if (a) accountIds.add(a);
  }
  for (const c of renewals) {
    const a = idOf(c.accountId);
    if (a) accountIds.add(a);
  }
  for (const r of [...overdueActivities, ...overdueFollowUps]) {
    const a = idOf((r as Ref).assigneeId);
    if (a) userIds.add(a);
  }
  const [users, accounts] = await Promise.all([
    userIds.size ? User.find({ _id: { $in: [...userIds] } }).select('name email').lean() : [],
    accountIds.size ? CrmAccount.find({ _id: { $in: [...accountIds] } }).select('name').lean() : [],
  ]);
  const userName = new Map(users.map((u) => [String(u._id), u.name || u.email]));
  const accountName = new Map(accounts.map((a) => [String(a._id), a.name]));
  const nameOfUser = (v: unknown) => (idOf(v) ? (userName.get(idOf(v)!) ?? null) : null);
  const nameOfAccount = (v: unknown) => (idOf(v) ? (accountName.get(idOf(v)!) ?? null) : null);

  // ── Month-over-month momentum ──
  const inRange = (d: Date | undefined, from: Date, to: Date) => !!d && d >= from && d < to;
  const won = closedYear.filter((d) => d.status === 'won');
  const lost = closedYear.filter((d) => d.status === 'lost');
  const periodStats = (from: Date, to: Date) => {
    const w = won.filter((d) => inRange(d.updatedAt, from, to));
    const l = lost.filter((d) => inRange(d.updatedAt, from, to));
    return {
      wonCount: w.length,
      wonValue: w.reduce((s, d) => s + (d.value ?? 0), 0),
      lostCount: l.length,
      winRate: pct(w.length, w.length + l.length),
      newLeads: leadsRecent.filter((x) => inRange(x.createdAt, from, to)).length,
      newDeals: openDeals.filter((d) => inRange(d.createdAt, from, to)).length + [...w, ...l].filter((d) => inRange(d.createdAt, from, to)).length,
    };
  };
  const momentum = { thisMonth: periodStats(monthStart, nextMonthStart), lastMonth: periodStats(lastMonthStart, monthStart) };

  // ── Velocity ──
  const cycleDays = won.map((d) => Math.max(0, (d.updatedAt.getTime() - d.createdAt.getTime()) / DAY));
  const openAges = openDeals.map((d) => (now.getTime() - d.createdAt.getTime()) / DAY);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
  const closingThisMonth = openDeals.filter((d) => inRange(d.expectedCloseDate, monthStart, nextMonthStart));
  const velocity = {
    avgSalesCycleDays: Math.round(avg(cycleDays)),
    avgWonDealSize: Math.round(avg(won.map((d) => d.value ?? 0))),
    avgOpenDealAgeDays: Math.round(avg(openAges)),
    winRate12m: pct(won.length, won.length + lost.length),
    closingThisMonth: {
      count: closingThisMonth.length,
      value: closingThisMonth.reduce((s, d) => s + (d.value ?? 0), 0),
      weighted: Math.round(closingThisMonth.reduce((s, d) => s + (d.value ?? 0) * ((d.probability ?? 0) / 100), 0)),
    },
  };

  // ── Attention ──
  const dealRef = (d: (typeof openDeals)[number]) => ({
    _id: String(d._id),
    title: d.title,
    value: d.value ?? 0,
    currency: d.currency,
    probability: d.probability ?? 0,
    stage: stageMap.get(String(d.stageId))?.name ?? 'Unknown',
    owner: nameOfUser(d.ownerId),
    account: nameOfAccount(d.accountId),
    accountId: idOf(d.accountId),
    expectedCloseDate: d.expectedCloseDate ?? null,
    lastTouchedAt: d.updatedAt,
  });
  const overdueDeals = openDeals.filter((d) => d.expectedCloseDate && d.expectedCloseDate < now);
  const staleDeals = openDeals.filter((d) => d.updatedAt < staleBefore);
  const byValue = (a: { value?: number }, b: { value?: number }) => (b.value ?? 0) - (a.value ?? 0);

  const attention = {
    staleDays: STALE_DEAL_DAYS,
    overdueDeals: {
      count: overdueDeals.length,
      value: overdueDeals.reduce((s, d) => s + (d.value ?? 0), 0),
      items: [...overdueDeals].sort(byValue).slice(0, 6).map(dealRef),
    },
    staleDeals: {
      count: staleDeals.length,
      value: staleDeals.reduce((s, d) => s + (d.value ?? 0), 0),
      items: [...staleDeals].sort(byValue).slice(0, 6).map(dealRef),
    },
    overdueActivities: {
      count: overdueActivityCount,
      items: overdueActivities.map((a) => ({
        _id: String(a._id),
        type: a.type,
        subject: a.subject,
        dueAt: a.dueAt,
        relatedType: a.relatedType,
        relatedId: idOf(a.relatedId),
        assignee: nameOfUser(a.assigneeId),
      })),
    },
    overdueFollowUps: {
      count: overdueFollowUpCount,
      items: overdueFollowUps.map((l) => ({
        _id: String(l._id),
        title: l.title,
        companyName: l.companyName ?? null,
        status: l.status,
        nextFollowUpAt: l.nextFollowUpAt,
        assignee: nameOfUser(l.assigneeId),
      })),
    },
    expiringQuotes: expiringQuotes.map((q) => ({
      _id: String(q._id),
      title: q.title,
      total: q.total ?? 0,
      currency: q.currency,
      validUntil: q.validUntil,
    })),
    renewals: renewals
      .map((c) => ({
        _id: String(c._id),
        title: c.title,
        value: c.value ?? 0,
        currency: c.currency,
        date: c.renewalDate ?? c.endDate ?? null,
        autoRenew: !!c.autoRenew,
        account: nameOfAccount(c.accountId),
        accountId: idOf(c.accountId),
      }))
      .sort((a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime()),
  };

  // ── Top open deals ──
  const topDeals = [...openDeals].sort(byValue).slice(0, 6).map(dealRef);

  // ── Leads: source conversion + monthly trend ──
  const leadSources = leadSourcesAgg.map((r) => ({
    name: String(r._id || 'unknown'),
    total: r.total as number,
    converted: r.converted as number,
    unqualified: r.lost as number,
    conversionRate: pct(r.converted as number, r.total as number),
  }));
  const months = lastNMonths(6);
  const leadTrendMap = new Map(months.map((m) => [m, { month: m, created: 0, converted: 0 }]));
  for (const l of leadsRecent) {
    const row = leadTrendMap.get(monthKey(new Date(l.createdAt)));
    if (!row) continue;
    row.created += 1;
    if (l.status === 'converted') row.converted += 1;
  }
  const leadTrend = months.map((m) => leadTrendMap.get(m)!);

  // ── Owner leaderboard ──
  type OwnerRow = { id: string | null; name: string; openCount: number; openValue: number; weighted: number; wonCount: number; wonValue: number; lostCount: number };
  const owners = new Map<string, OwnerRow>();
  const ownerRow = (v: unknown) => {
    const id = idOf(v);
    const key = id ?? 'unassigned';
    let row = owners.get(key);
    if (!row) {
      row = { id, name: id ? (userName.get(id) ?? 'Unknown user') : 'Unassigned', openCount: 0, openValue: 0, weighted: 0, wonCount: 0, wonValue: 0, lostCount: 0 };
      owners.set(key, row);
    }
    return row;
  };
  for (const d of openDeals) {
    const r = ownerRow(d.ownerId);
    r.openCount += 1;
    r.openValue += d.value ?? 0;
    r.weighted += (d.value ?? 0) * ((d.probability ?? 0) / 100);
  }
  for (const d of closedYear) {
    const r = ownerRow(d.ownerId);
    if (d.status === 'won') {
      r.wonCount += 1;
      r.wonValue += d.value ?? 0;
    } else r.lostCount += 1;
  }
  const leaderboard = [...owners.values()]
    .map((r) => ({ ...r, weighted: Math.round(r.weighted), winRate: pct(r.wonCount, r.wonCount + r.lostCount) }))
    .sort((a, b) => b.wonValue - a.wonValue || b.openValue - a.openValue)
    .slice(0, 8);

  // ── Loss reasons (last 12 months) ──
  const lossMap = new Map<string, { name: string; count: number; value: number }>();
  for (const d of lost) {
    const name = (d.lossReason ?? '').trim() || 'Not specified';
    const row = lossMap.get(name.toLowerCase()) ?? { name, count: 0, value: 0 };
    row.count += 1;
    row.value += d.value ?? 0;
    lossMap.set(name.toLowerCase(), row);
  }
  const lossReasons = [...lossMap.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  // ── Quotes ──
  const quoteOutcome = Object.fromEntries(quoteOutcomes.map((r) => [String(r._id), r.count as number]));
  const quoteDecided = (quoteOutcome.accepted ?? 0) + (quoteOutcome.rejected ?? 0) + (quoteOutcome.expired ?? 0);

  // ── Activity cadence (last 30 vs previous 30 days) ──
  const d30 = new Date(now.getTime() - 30 * DAY);
  const activityLast30 = activityRecent.filter((a) => a.createdAt >= d30).length;

  return {
    momentum,
    velocity,
    attention,
    topDeals,
    leadSources,
    leadTrend,
    leaderboard,
    lossReasons,
    quoteAcceptanceRate: pct(quoteOutcome.accepted ?? 0, quoteDecided),
    activityCadence: { last30: activityLast30, prev30: activityRecent.length - activityLast30 },
  };
}

export async function getExecutiveCrmMetrics(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const [wonDeals, activeContracts, ticketsByStatus] = await Promise.all([
    CrmDeal.countDocuments({ taskflowOrganizationId: orgOid, status: 'won' }),
    CrmContract.countDocuments({ taskflowOrganizationId: orgOid, status: 'active' }),
    ServiceTicket.aggregate([
      { $match: { taskflowOrganizationId: orgOid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);
  return {
    wonDeals,
    activeContracts,
    ticketsByStatus: Object.fromEntries(ticketsByStatus.map((r) => [r._id, r.count])),
  };
}
