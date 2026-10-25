import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FiActivity, FiAlertTriangle, FiArrowLeft, FiCheckCircle } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { employee360Api, type Employee360 as Data } from '../../lib/api';
import { money, StatusPill } from '../../components/moduleKit';
import RecordLinksPanel from '../../components/RecordLinksPanel';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';

const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtShort = (v?: string | null) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');
const pretty = (s?: string) => (s ? s.replace(/_/g, ' ') : '—');

/** One page for a person: work, capacity, time, leave, attendance, pay and skills. `/employees/me` shows your own. */
export default function Employee360() {
  const { id = 'me' } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void employee360Api.get(id, token).then((res) => {
      if (!live) return;
      if (res.success && res.data) {
        setData(res.data);
        setError(null);
      } else setError(res.message ?? 'Could not load this person');
    });
    return () => {
      live = false;
    };
  }, [token, id]);

  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm text-[color:var(--text-muted)]">{error}</p>
      </div>
    );
  }
  if (!data) return <ModuleLoader size="page" label="Loading…" />;

  const { employee: e, profile, flags, work, allocations, timesheet, leave, attendance, payroll } = data;
  const maxWeek = Math.max(profile.capacityHoursPerWeek, ...(timesheet?.weeks.map((w) => w.hours) ?? [0]));

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      {!data.isSelf && (
        <Link to="/hrms/employees" className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
          <FiArrowLeft /> Employees
        </Link>
      )}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">{data.isSelf ? 'My 360' : 'Employee 360'}</p>
          <h1 className="text-2xl font-bold tracking-tight mt-1 truncate">{e.name}</h1>
          <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
            {[e.designation, e.department, e.employeeCode, pretty(e.employmentType), e.location, e.joinedDate ? `joined ${fmtDate(e.joinedDate)}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-[13px] mt-1">
            {e.manager && (
              <>
                Reports to{' '}
                <Link to={`/employees/${e.manager.id}`} className="text-[color:var(--accent)] hover:underline">
                  {e.manager.name}
                </Link>
              </>
            )}
            {e.reports.length > 0 && (
              <span className="text-[color:var(--text-muted)]">
                {e.manager ? ' · ' : ''}
                {e.reports.length} direct report{e.reports.length === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        <StatusPill label={e.status} tone={e.status === 'active' ? 'green' : e.status === 'terminated' ? 'red' : 'amber'} />
      </header>

      <Flags flags={flags} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Open work" value={String(work.summary.open)} hint={`${work.summary.overdue} overdue · ${work.summary.dueSoon} due this week`} tone={work.summary.overdue ? 'amber' : undefined} />
        <Kpi label="Done (30 days)" value={String(work.summary.doneLast30)} />
        {allocations && (
          <Kpi
            label="Allocated now"
            value={`${allocations.currentPercent}%`}
            hint={`${allocations.items.filter((a) => a.current).length} project${allocations.items.filter((a) => a.current).length === 1 ? '' : 's'}`}
            tone={allocations.currentPercent > 100 ? 'red' : undefined}
          />
        )}
        {timesheet && (
          <Kpi
            label="Logged last week"
            value={`${timesheet.lastWeek.loggedHours}h`}
            hint={timesheet.lastWeek.submitted ? 'submitted' : timesheet.lastWeek.loggedHours ? 'not submitted' : `capacity ${profile.capacityHoursPerWeek}h`}
            tone={timesheet.lastWeek.loggedHours && !timesheet.lastWeek.submitted ? 'amber' : undefined}
          />
        )}
        {leave && <Kpi label="Leave balance" value={`${leave.balanceDays}d`} hint={`${leave.takenThisYear}d taken this year`} />}
        {attendance && (
          <Kpi
            label="Attendance (30 days)"
            value={`${(attendance.counts.present ?? 0) + (attendance.counts.remote ?? 0)}/${attendance.days}`}
            hint={`${attendance.counts.absent ?? 0} absent · ${attendance.hours}h`}
            tone={(attendance.counts.absent ?? 0) > 2 ? 'amber' : undefined}
          />
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Assigned work" note={work.hiddenProjects ? `${work.hiddenProjects} project${work.hiddenProjects === 1 ? '' : 's'} you can't open not shown` : undefined}>
          {work.items.length === 0 ? (
            <Empty>No open work assigned.</Empty>
          ) : (
            <Rows>
              {work.items.map((i) => (
                <Row
                  key={i.id}
                  to={`/projects/${i.projectId}/issues/${encodeURIComponent(i.key ?? i.id)}`}
                  title={`${i.key ? `${i.key} · ` : ''}${i.title}`}
                  meta={[i.priority, i.dueDate ? `due ${fmtDate(i.dueDate)}` : null].filter(Boolean).join(' · ')}
                  right={i.overdue ? <StatusPill label="overdue" tone="red" /> : <StatusPill label={i.status} tone="blue" />}
                />
              ))}
            </Rows>
          )}
        </Panel>

        <Panel title="Skills & capacity">
          <div className="flex flex-wrap gap-1.5 mb-3">
            {profile.skills.length === 0 ? (
              <Empty>No skills recorded yet.</Empty>
            ) : (
              profile.skills.map((s) => (
                <span key={s} className="rounded-full bg-[color:var(--accent)]/10 text-[color:var(--accent)] px-2.5 py-1 text-xs">
                  {s}
                </span>
              ))
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Fact label="Capacity">{profile.capacityHoursPerWeek}h / week</Fact>
            <Fact label="Seniority">{profile.seniority || '—'}</Fact>
            {profile.availableFrom && <Fact label="Available from">{fmtDate(profile.availableFrom)}</Fact>}
            {e.email && <Fact label="Email">{e.email}</Fact>}
          </dl>
          {e.reports.length > 0 && (
            <div className="mt-4 border-t border-[color:var(--border-subtle)] pt-3">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5">Direct reports</h3>
              <div className="flex flex-wrap gap-2">
                {e.reports.map((r) => (
                  <Link key={r.id} to={`/employees/${r.id}`} className="rounded-full border border-[color:var(--border-subtle)] px-2.5 py-1 text-xs hover:border-[color:var(--accent)]/40">
                    {r.name}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {allocations && (
          <Panel title="Allocations">
            {allocations.items.length === 0 ? (
              <Empty>No current or upcoming allocations.</Empty>
            ) : (
              <Rows>
                {allocations.items.map((a) => (
                  <Row
                    key={a.id}
                    to={a.projectId ? `/projects/${a.projectId}` : '#'}
                    title={`${a.projectKey ? `${a.projectKey} · ` : ''}${a.project ?? 'Project'}`}
                    meta={[a.role, `${fmtShort(a.startDate)} – ${a.endDate ? fmtShort(a.endDate) : 'open'}`, a.billable ? 'billable' : 'non-billable', a.softBooked ? 'soft-booked' : null]
                      .filter(Boolean)
                      .join(' · ')}
                    right={
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">{a.percent}%</span>
                        {!a.current && <StatusPill label="upcoming" tone="slate" />}
                      </span>
                    }
                  />
                ))}
              </Rows>
            )}
          </Panel>
        )}

        {timesheet && (
          <Panel title="Timesheet" note="last 4 weeks">
            <ul className="space-y-2">
              {timesheet.weeks.map((w) => (
                <li key={w.weekStart} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0 text-xs text-[color:var(--text-muted)]">{fmtShort(w.weekStart)}</span>
                  <div className="relative h-2 flex-1 rounded-full bg-[color:var(--border-subtle)] overflow-hidden">
                    <div className="absolute inset-y-0 left-0 bg-[color:var(--accent)]/40" style={{ width: `${maxWeek ? (w.hours / maxWeek) * 100 : 0}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-[color:var(--accent)]" style={{ width: `${maxWeek ? (w.billableHours / maxWeek) * 100 : 0}%` }} />
                  </div>
                  <span className="w-12 shrink-0 text-right tabular-nums text-xs">{w.hours}h</span>
                  <span className="w-20 shrink-0 text-right">
                    {w.submission ? <StatusPill label={w.submission} tone={w.submission === 'approved' ? 'green' : w.submission === 'rejected' ? 'red' : 'blue'} /> : null}
                  </span>
                </li>
              ))}
            </ul>
            {timesheet.projects.length > 0 && (
              <p className="mt-3 text-xs text-[color:var(--text-muted)]">
                {timesheet.projects.map((p) => `${p.name} ${p.hours}h`).join(' · ')}
              </p>
            )}
          </Panel>
        )}

        {leave && (
          <Panel title="Leave" note={`${leave.balanceDays} days left`}>
            {leave.onLeaveNow && (
              <p className="mb-2 text-sm text-amber-600 dark:text-amber-400">
                On {pretty(leave.onLeaveNow.type)} leave until {fmtDate(leave.onLeaveNow.endDate)}
              </p>
            )}
            {leave.recent.length === 0 ? (
              <Empty>No leave requests.</Empty>
            ) : (
              <Rows>
                {leave.recent.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 min-w-0 truncate capitalize">
                      {pretty(l.type)} · {fmtShort(l.startDate)}
                      {l.endDate !== l.startDate ? ` – ${fmtShort(l.endDate)}` : ''}
                    </span>
                    <span className="text-xs tabular-nums">{l.days}d</span>
                    <StatusPill label={l.status} tone={l.status === 'approved' ? 'green' : l.status === 'pending' ? 'amber' : 'slate'} />
                  </li>
                ))}
              </Rows>
            )}
          </Panel>
        )}

        {attendance && (
          <Panel title="Attendance" note="last 30 days">
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(attendance.counts)
                .filter(([, n]) => n > 0)
                .map(([status, n]) => (
                  <StatusPill key={status} label={`${pretty(status)} ${n}`} tone={status === 'absent' ? 'red' : status === 'present' || status === 'remote' ? 'green' : 'slate'} />
                ))}
            </div>
            {attendance.recent.length === 0 ? (
              <Empty>No attendance recorded.</Empty>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {attendance.recent.map((a) => (
                  <li key={a.date} className="rounded-lg border border-[color:var(--border-subtle)] px-2 py-1.5">
                    <span className="block text-[color:var(--text-muted)]">{fmtShort(a.date)}</span>
                    <span className="capitalize">{pretty(a.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}

        {payroll && (
          <Panel title="Payroll">
            {payroll.payslips.length === 0 ? (
              <Empty>No payslips yet.</Empty>
            ) : (
              <Rows>
                {payroll.payslips.map((p) => (
                  <li key={p.period} className="flex items-center gap-3 py-2 text-sm">
                    <span className="flex-1 min-w-0">
                      <span className="font-medium">{p.period}</span>
                      <span className="block text-xs text-[color:var(--text-muted)]">
                        gross {money(p.gross, p.currency)} · deductions {money(p.deductions, p.currency)}
                        {p.lopDays ? ` · ${p.lopDays} LOP day${p.lopDays === 1 ? '' : 's'}` : ''}
                        {p.monthlyCtc != null ? ` · CTC ${money(p.monthlyCtc, p.currency)}/mo` : ''}
                      </span>
                    </span>
                    <span className="tabular-nums font-semibold">{money(p.net, p.currency)}</span>
                    <StatusPill label={p.status} tone={p.status === 'paid' ? 'green' : p.status === 'finalized' ? 'blue' : 'slate'} />
                  </li>
                ))}
              </Rows>
            )}
          </Panel>
        )}
      </div>

      {!data.isSelf && <RecordLinksPanel type="employee" id={e.id} />}
    </div>
  );
}

function Flags({ flags }: { flags: Data['flags'] }) {
  if (!flags.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <FiCheckCircle /> Nothing needs attention.
      </div>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {flags.map((f, i) => (
        <li
          key={`${f.area}-${i}`}
          className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm ${
            f.level === 'red'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          }`}
        >
          {f.level === 'red' ? <FiAlertTriangle className="shrink-0" /> : <FiActivity className="shrink-0" />}
          <span className="min-w-0 truncate">{f.text}</span>
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

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
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
