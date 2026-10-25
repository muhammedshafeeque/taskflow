import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { customer360Api, type Customer360 as Data, type SlaState } from '../../lib/api';
import { money, StatusPill } from '../../components/moduleKit';
import RecordLinksPanel from '../../components/RecordLinksPanel';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const SLA_TONE: Record<SlaState, 'red' | 'amber' | 'green' | 'slate'> = { breached: 'red', at_risk: 'amber', ok: 'green', none: 'slate' };
const SLA_LABEL: Record<SlaState, string> = { breached: 'SLA breached', at_risk: 'SLA at risk', ok: 'On track', none: 'No SLA' };

/** One page for a portal customer: commercial, delivery, support, billing and reliability together. */
export default function Customer360() {
  const { id = '' } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    let live = true;
    void customer360Api.get(id, token).then((res) => {
      if (!live) return;
      if (res.success && res.data) setData(res.data);
      else setError(res.message ?? 'Could not load customer');
    });
    return () => {
      live = false;
    };
  }, [token, id]);

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm text-rose-500">{error}</p>
      </div>
    );
  }
  if (!data) return <ModuleLoader size="page" label="Loading customer…" />;

  const { customer, health, deals, contracts, issues, tickets, invoices, monitor } = data;
  const cur = invoices?.summary.currency;
  const projectName = new Map(data.projects.map((p) => [p.id, p]));

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <Link to="/admin/customer-orgs" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
        <FiArrowLeft /> Customers
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">Customer 360</p>
          <h1 className="text-2xl font-bold tracking-tight mt-1 truncate">{customer.name}</h1>
          <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
            {[customer.contactEmail, customer.contactPhone, customer.since ? `Customer since ${fmtDate(customer.since)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {customer.accounts.length > 0 && (
            <p className="text-[13px] mt-1">
              CRM:{' '}
              {customer.accounts.map((a, i) => (
                <span key={a.id}>
                  {i > 0 && ', '}
                  <Link to={`/crm/accounts/${a.id}`} className="text-[color:var(--accent)] hover:underline">
                    {a.name}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex gap-2 text-xs">
          <Link to={`/admin/customer-orgs/${customer.id}`} className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 hover:border-[color:var(--accent)]/40">
            Portal settings
          </Link>
        </div>
      </header>

      <HealthStrip health={health} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {deals && <Kpi label="Open pipeline" value={money(deals.summary.pipeline, cur)} hint={`${deals.summary.open} open · ${money(deals.summary.won, cur)} won`} />}
        {contracts && <Kpi label="Active contracts" value={String(contracts.summary.active)} hint={money(contracts.summary.activeValue, cur)} />}
        <Kpi label="Open issues" value={String(issues.summary.open)} hint={`${issues.summary.overdue} overdue`} tone={issues.summary.overdue ? 'amber' : undefined} />
        {tickets && (
          <Kpi
            label="Open tickets"
            value={String(tickets.summary.open)}
            hint={`${tickets.sla.breached} past SLA · ${tickets.sla.atRisk} at risk`}
            tone={tickets.sla.breached ? 'red' : tickets.sla.atRisk ? 'amber' : undefined}
          />
        )}
        {invoices && (
          <Kpi
            label="Outstanding"
            value={money(invoices.summary.outstanding, cur)}
            hint={invoices.summary.overdueCount ? `${money(invoices.summary.overdue, cur)} overdue` : `${money(invoices.summary.collected, cur)} collected`}
            tone={invoices.summary.overdueCount ? 'red' : undefined}
          />
        )}
        {monitor && (
          <Kpi
            label="Monitoring"
            value={monitor.projects.length === 0 ? '—' : monitor.projects.some((m) => m.uptime === 'down') ? 'Down' : 'Up'}
            hint={`${monitor.projects.reduce((s, m) => s + m.openErrors, 0)} open errors`}
            tone={monitor.projects.some((m) => m.uptime === 'down') ? 'red' : undefined}
          />
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Projects & open issues" note={data.hiddenProjects ? `${data.hiddenProjects} project${data.hiddenProjects === 1 ? '' : 's'} you're not a member of` : undefined}>
          {data.projects.length === 0 ? (
            <Empty>No projects mapped to this customer.</Empty>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {data.projects.map((p) => (
                  <Link key={p.id} to={`/projects/${p.id}`} className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-xs hover:border-[color:var(--accent)]/40">
                    {p.key ? `${p.key} · ` : ''}
                    {p.name}
                  </Link>
                ))}
              </div>
              {issues.items.length === 0 ? (
                <Empty>No open issues.</Empty>
              ) : (
                <Rows>
                  {issues.items.map((i) => (
                    <Row
                      key={i.id}
                      to={`/projects/${i.projectId}/issues/${encodeURIComponent(i.key ?? i.id)}`}
                      title={`${i.key ? `${i.key} · ` : ''}${i.title}`}
                      meta={[projectName.get(i.projectId)?.key, i.assignee, i.dueDate ? `due ${fmtDate(i.dueDate)}` : null].filter(Boolean).join(' · ')}
                      right={i.overdue ? <StatusPill label="overdue" tone="red" /> : <StatusPill label={i.status} tone="blue" />}
                    />
                  ))}
                </Rows>
              )}
            </>
          )}
        </Panel>

        {tickets && (
          <Panel title="Tickets & SLA" note={tickets.csat ? `CSAT ${tickets.csat.average}/5 · ${tickets.csat.responses} in 90 days` : undefined}>
            {tickets.items.length === 0 ? (
              <Empty>No open tickets.</Empty>
            ) : (
              <Rows>
                {tickets.items.map((t) => (
                  <Row
                    key={t.id}
                    to={`/service/tickets?ticket=${t.id}`}
                    title={t.subject}
                    meta={[t.priority, t.linkedIssueKey, t.resolutionDueAt ? `resolve by ${fmtDate(t.resolutionDueAt)}` : null].filter(Boolean).join(' · ')}
                    right={<StatusPill label={SLA_LABEL[t.sla]} tone={SLA_TONE[t.sla]} />}
                  />
                ))}
              </Rows>
            )}
            {contracts && contracts.slaPolicies.length > 0 && (
              <div className="mt-4 border-t border-[color:var(--border-subtle)] pt-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5">Contracted SLA</h3>
                {contracts.slaPolicies.map((p) => (
                  <p key={p.id} className="text-xs">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-[color:var(--text-muted)]">
                      {' — '}
                      {p.targets.map((t) => `${t.priority}: respond ${mins(t.firstResponseMinutes)}, resolve ${mins(t.resolutionMinutes)}`).join(' · ') || 'no targets'}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </Panel>
        )}

        {invoices && (
          <Panel title="Invoices & payments" note={`${money(invoices.summary.invoiced, cur)} invoiced · ${money(invoices.summary.collected, cur)} collected`}>
            {invoices.items.length === 0 ? (
              <Empty>No invoices yet.</Empty>
            ) : (
              <Rows>
                {invoices.items.slice(0, 10).map((i) => (
                  <Row
                    key={i.id}
                    to={`/billing/invoices/${i.id}`}
                    title={i.number}
                    meta={`${money(i.total, i.currency)} · issued ${fmtDate(i.issueDate)}${i.dueDate ? ` · due ${fmtDate(i.dueDate)}` : ''}`}
                    right={
                      <span className="flex items-center gap-2">
                        {i.balance > 0 && <span className="text-xs tabular-nums">{money(i.balance, i.currency)} due</span>}
                        <StatusPill label={i.status} tone={i.status === 'overdue' ? 'red' : i.status === 'paid' ? 'green' : 'blue'} />
                      </span>
                    }
                  />
                ))}
              </Rows>
            )}
            {invoices.payments.length > 0 && (
              <div className="mt-4 border-t border-[color:var(--border-subtle)] pt-3">
                <h3 className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5">Recent payments</h3>
                <ul className="space-y-1 text-xs">
                  {invoices.payments.slice(0, 6).map((p, i) => (
                    <li key={`${p.invoiceId}-${i}`} className="flex justify-between gap-3">
                      <span className="text-[color:var(--text-muted)]">
                        {fmtDate(p.date)} · {p.invoiceNumber ?? 'invoice'}
                      </span>
                      <span className="tabular-nums font-medium">{money(p.amount, p.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>
        )}

        {deals && (
          <Panel title="Deals">
            {deals.items.length === 0 ? (
              <Empty>No deals.</Empty>
            ) : (
              <Rows>
                {deals.items.slice(0, 10).map((d) => (
                  <Row
                    key={d.id}
                    to={`/crm/deals/${d.id}`}
                    title={d.title}
                    meta={[d.stage, d.expectedCloseDate ? `close ${fmtDate(d.expectedCloseDate)}` : null].filter(Boolean).join(' · ')}
                    right={
                      <span className="flex items-center gap-2">
                        <span className="text-xs tabular-nums">{money(d.value, d.currency)}</span>
                        <StatusPill label={d.status} tone={d.status === 'won' ? 'green' : d.status === 'lost' ? 'red' : 'blue'} />
                      </span>
                    }
                  />
                ))}
              </Rows>
            )}
          </Panel>
        )}

        {contracts && (
          <Panel title="Contracts">
            {contracts.items.length === 0 ? (
              <Empty>No contracts.</Empty>
            ) : (
              <Rows>
                {contracts.items.map((c) => (
                  <Row
                    key={c.id}
                    to={`/contracts/${c.id}`}
                    title={c.title}
                    meta={[
                      c.kind,
                      c.slaPolicy ? `SLA ${c.slaPolicy}` : null,
                      c.renewsInDays != null ? (c.renewsInDays >= 0 ? `renews in ${c.renewsInDays}d` : `lapsed ${-c.renewsInDays}d ago`) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <span className="flex items-center gap-2">
                        <span className="text-xs tabular-nums">{money(c.value, c.currency)}</span>
                        <StatusPill label={c.status} tone={c.status === 'active' ? 'green' : 'slate'} />
                      </span>
                    }
                  />
                ))}
              </Rows>
            )}
          </Panel>
        )}

        {monitor && (
          <Panel title="Monitoring">
            {monitor.projects.length === 0 ? (
              <Empty>None of this customer's projects are monitored.</Empty>
            ) : (
              <Rows>
                {monitor.projects.map((m) => (
                  <Row
                    key={m.id}
                    to={`/monitor/${m.id}`}
                    title={m.name}
                    meta={[
                      `${m.openErrors} open error${m.openErrors === 1 ? '' : 's'}`,
                      `${m.checks} uptime check${m.checks === 1 ? '' : 's'}`,
                      m.downChecks.length ? `down: ${m.downChecks.join(', ')}` : null,
                      m.lastCheckedAt ? `checked ${new Date(m.lastCheckedAt).toLocaleString()}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    right={<StatusPill label={m.uptime} tone={m.uptime === 'down' ? 'red' : m.uptime === 'up' ? 'green' : 'slate'} />}
                  />
                ))}
              </Rows>
            )}
          </Panel>
        )}
      </div>

      <RecordLinksPanel type="customer" id={customer.id} />
    </div>
  );
}

function mins(n: number) {
  return n >= 60 * 24 ? `${Math.round(n / 60 / 24)}d` : n >= 60 ? `${Math.round(n / 60)}h` : `${n}m`;
}

function HealthStrip({ health }: { health: Data['health'] }) {
  if (!health.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <FiCheckCircle /> Nothing needs attention for this customer.
      </div>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {health.map((h, i) => (
        <li
          key={`${h.area}-${i}`}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            h.level === 'red'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          }`}
        >
          {h.level === 'red' ? <FiAlertTriangle className="shrink-0" /> : <FiActivity className="shrink-0" />}
          <span className="min-w-0 truncate">{h.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'red' | 'amber' }) {
  const ring = tone === 'red' ? 'border-rose-500/40' : tone === 'amber' ? 'border-amber-500/40' : 'border-[color:var(--border-subtle)]';
  return (
    <div className={`rounded-xl border ${ring} bg-[color:var(--bg-surface)] px-4 py-3 card-shadow min-w-0`}>
      <p className="text-[11px] font-medium text-[color:var(--text-muted)]">{label}</p>
      <p className="text-xl font-bold tabular-nums truncate mt-0.5">{value}</p>
      {hint && <p className="text-[11px] text-[color:var(--text-muted)] truncate mt-0.5">{hint}</p>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <span className="text-xs text-[color:var(--text-muted)]">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-[color:var(--border-subtle)]">{children}</ul>;
}

function Row({ to, title, meta, right }: { to: string; title: string; meta?: string; right?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2 min-w-0">
      <div className="min-w-0 flex-1">
        <Link to={to} className="block truncate text-sm font-medium hover:text-[color:var(--accent)]">
          {title}
        </Link>
        {meta && <p className="truncate text-xs text-[color:var(--text-muted)]">{meta}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </li>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[color:var(--text-muted)]">{children}</p>;
}
