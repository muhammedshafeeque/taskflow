import { CrmAccount } from '../models/crmAccount.model';
import { CrmContact } from '../models/crmContact.model';
import { CrmLead } from '../models/crmLead.model';
import { CrmDeal } from '../models/crmDeal.model';
import { CrmActivity } from '../models/crmActivity.model';
import { CrmContract } from '../models/crmContract.model';
import { CrmQuote } from '../models/crmQuote.model';
import { CrmPipeline } from '../models/crmPipeline.model';
import { ServiceTicket } from '../../service-desk/models/serviceTicket.model';
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
