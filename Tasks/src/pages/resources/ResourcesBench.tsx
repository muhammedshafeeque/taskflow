import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiDownload, FiPlus } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import SectionCard from '../../components/SectionCard';
import { downloadCsv } from '../../lib/exportCsv';
import { resourcesApi, type ResourceSkillRow } from '../../lib/api';
import {
  AllocationModal,
  Chip,
  EmptyState,
  ErrorBanner,
  LoadBar,
  LoadingBlock,
  PageShell,
  Segmented,
  Stat,
  Toast,
  blankAllocation,
  btnSecondary,
  errorOf,
  fmtShort,
  inputCls,
  refName,
  relDays,
  toInputDate,
  useResourceOptions,
  type AllocationDraft,
} from './resourceKit';

interface BenchPerson {
  userId: string;
  name: string;
  email: string;
  skills: string[];
  department?: string;
  seniority?: string;
  location?: string;
  capacityHoursPerWeek: number;
  availableFrom?: string | null;
  committedPercent: number;
  softPercent: number;
  availablePercent: number;
  freeHoursNext4Weeks: number;
  nextFreeDate: string | null;
  onBench: boolean;
  rollingOff: boolean;
  projects: Array<{ allocationId: string; id: string; name?: string; key?: string; percent: number; softBooked: boolean; endDate: string | null }>;
  upcoming: Array<{ allocationId: string; name?: string; key?: string; percent: number; softBooked: boolean; startDate: string }>;
}

interface BenchReport {
  threshold: number;
  days: number;
  today: string;
  summary: { onBench: number; rollingOff: number; freeHoursNext4Weeks: number; benchHoursPerWeek: number };
  people: BenchPerson[];
}

type View = 'bench' | 'rolling' | 'everyone' | 'skills';

export default function ResourcesBench() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const { options } = useResourceOptions(token, workspaceKey);
  const settings = options.settings;
  const [threshold, setThreshold] = useState<number | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [data, setData] = useState<BenchReport | null>(null);
  const [skills, setSkills] = useState<{ skills: ResourceSkillRow[]; summary: { skills: number; gaps: number; peopleWithoutSkills: number; singlePointSkills: number } } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState<View>('bench');
  const [search, setSearch] = useState('');
  const [skill, setSkill] = useState('');
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      resourcesApi.bench(token, { threshold: threshold ?? undefined, days: days ?? undefined }),
      resourcesApi.skills(token),
    ]).then(([b, s]) => {
      setLoading(false);
      if (b.success && b.data) {
        setData(b.data as BenchReport);
        setError('');
      } else setError(errorOf(b, 'Failed to load bench'));
      if (s.success && s.data) setSkills(s.data);
    });
  }, [token, threshold, days]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  const allSkills = useMemo(() => [...new Set((data?.people ?? []).flatMap((p) => p.skills))].sort((a, b) => a.localeCompare(b)), [data]);

  const people = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const sk = skill.toLowerCase();
    return data.people.filter((p) => {
      if (view === 'bench' && !p.onBench) return false;
      if (view === 'rolling' && !p.rollingOff) return false;
      if (sk && !p.skills.some((s) => s.toLowerCase() === sk)) return false;
      if (!q) return true;
      return `${p.name} ${p.email} ${p.department ?? ''} ${p.seniority ?? ''} ${p.skills.join(' ')}`.toLowerCase().includes(q);
    });
  }, [data, view, search, skill]);

  function book(p: BenchPerson) {
    setDraft(
      blankAllocation({
        userId: p.userId,
        startDate: p.onBench ? (data?.today ?? toInputDate(new Date().toISOString())) : (p.nextFreeDate ?? data?.today ?? ''),
        percent: Math.max(5, Math.min(100, Math.round(p.availablePercent / 5) * 5)) || 50,
      })
    );
  }

  function exportCsv() {
    downloadCsv('bench', people, [
      { header: 'Person', value: (p) => p.name },
      { header: 'Email', value: (p) => p.email },
      { header: 'Department', value: (p) => p.department },
      { header: 'Skills', value: (p) => p.skills.join('; ') },
      { header: 'Committed %', value: (p) => p.committedPercent },
      { header: 'Soft %', value: (p) => p.softPercent },
      { header: 'Free h (4 wks)', value: (p) => p.freeHoursNext4Weeks },
      { header: 'Next free', value: (p) => p.nextFreeDate },
      { header: 'On bench', value: (p) => (p.onBench ? 'yes' : 'no') },
    ]);
  }

  return (
    <PageShell
      title="Bench & availability"
      description="Who has room now, who frees up soon, and which skills you can staff."
      actions={
        <button type="button" className={btnSecondary} onClick={exportCsv} disabled={people.length === 0 || view === 'skills'}>
          <FiDownload /> Export
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'bench', label: 'On bench', count: data?.summary.onBench },
            { value: 'rolling', label: 'Rolling off', count: data?.summary.rollingOff },
            { value: 'everyone', label: 'Everyone', count: data?.people.length },
            { value: 'skills', label: 'Skills', count: skills?.summary.skills },
          ]}
        />
        {view !== 'skills' && (
          <div className="flex flex-1 flex-wrap justify-end items-center gap-2 text-xs">
            <label className="flex items-center gap-1 text-[color:var(--text-muted)]">
              Bench below
              <input
                type="number"
                min={0}
                max={100}
                value={threshold ?? ''}
                placeholder={data ? String(data.threshold) : ''}
                onChange={(e) => setThreshold(e.target.value === '' ? null : Number(e.target.value))}
                className={`${inputCls} w-16 py-1`}
              />
              %
            </label>
            <label className="flex items-center gap-1 text-[color:var(--text-muted)]">
              Rolling off within
              <input
                type="number"
                min={1}
                max={366}
                value={days ?? ''}
                placeholder={data ? String(data.days) : ''}
                onChange={(e) => setDays(e.target.value === '' ? null : Number(e.target.value))}
                className={`${inputCls} w-16 py-1`}
              />
              days
            </label>
            {allSkills.length > 0 && (
              <select value={skill} onChange={(e) => setSkill(e.target.value)} className={`${inputCls} w-auto py-1`} aria-label="Skill">
                <option value="">Any skill</option>
                {allSkills.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
            <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-36 py-1`} />
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data ? (
        loading && <LoadingBlock label="Loading bench…" />
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="On bench" value={data.summary.onBench} hint={`under ${data.threshold}% committed`} tone={data.summary.onBench ? 'warn' : 'good'} />
            <Stat label="Rolling off" value={data.summary.rollingOff} hint={`within ${data.days} days`} />
            <Stat label="Bench hours / week" value={`${data.summary.benchHoursPerWeek.toLocaleString()}h`} />
            <Stat label="Free hours, next 4 wks" value={`${data.summary.freeHoursNext4Weeks.toLocaleString()}h`} hint="whole team" />
          </div>

          {view === 'skills' ? (
            <SkillsView data={skills} onPick={(s) => { setSkill(s); setView('everyone'); }} />
          ) : people.length === 0 ? (
            <EmptyState title={view === 'bench' ? 'Nobody is on the bench' : view === 'rolling' ? 'Nobody rolls off soon' : 'No people match'}>
              {view === 'bench' && 'Everyone is committed above the bench threshold.'}
            </EmptyState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {people.map((p) => (
                <article key={p.userId} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{p.name}</p>
                      <p className="text-[11px] text-[color:var(--text-muted)] truncate">
                        {[p.seniority, p.department, p.location].filter(Boolean).join(' · ') || p.email}
                      </p>
                    </div>
                    {p.onBench ? <Chip tone="info">On bench</Chip> : p.rollingOff ? <Chip tone="good">Free {relDays(p.nextFreeDate)}</Chip> : null}
                  </div>
                  <LoadBar hard={p.committedPercent} soft={p.softPercent} settings={settings} />
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="text-[color:var(--text-muted)]">Available</p>
                      <p className="font-semibold tabular-nums">{p.availablePercent}%</p>
                    </div>
                    <div>
                      <p className="text-[color:var(--text-muted)]">Free, 4 wks</p>
                      <p className="font-semibold tabular-nums">{p.freeHoursNext4Weeks}h</p>
                    </div>
                    <div>
                      <p className="text-[color:var(--text-muted)]">Next free</p>
                      <p className="font-semibold">{p.onBench ? 'now' : p.nextFreeDate ? fmtShort(p.nextFreeDate) : '—'}</p>
                    </div>
                  </div>
                  {p.availableFrom && p.availableFrom.slice(0, 10) > data.today && (
                    <p className="text-[11px] text-amber-400">Not available until {fmtShort(p.availableFrom)}</p>
                  )}
                  {(p.projects.length > 0 || p.upcoming.length > 0) && (
                    <ul className="text-xs space-y-0.5 text-[color:var(--text-muted)]">
                      {p.projects.map((a) => (
                        <li key={a.allocationId}>
                          <span className="text-[color:var(--text-primary)]">{refName({ name: a.name, key: a.key })}</span> {a.percent}%
                          {a.softBooked && ' (soft)'}
                          {a.endDate ? ` · ends ${fmtShort(a.endDate)}` : ''}
                        </li>
                      ))}
                      {p.upcoming.map((a) => (
                        <li key={a.allocationId} className="opacity-80">
                          Next: {refName({ name: a.name, key: a.key })} {a.percent}% from {fmtShort(a.startDate)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.skills.map((s) => (
                        <Chip key={s} tone={s.toLowerCase() === skill.toLowerCase() ? 'accent' : 'neutral'}>
                          {s}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-3 pt-1 text-xs">
                    {canManage && (
                      <button type="button" className="inline-flex items-center gap-1 text-[color:var(--accent)] hover:underline" onClick={() => book(p)}>
                        <FiPlus /> Book
                      </button>
                    )}
                    <Link to={`/resources/allocations?userId=${p.userId}&status=all`} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
                      Allocations
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {token && canManage && (
        <AllocationModal
          open={!!draft}
          draft={draft}
          options={options}
          token={token}
          lockUser
          onClose={() => setDraft(null)}
          onSaved={(m) => {
            setDraft(null);
            setToast(m ?? 'Saved.');
            load();
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

function SkillsView({
  data,
  onPick,
}: {
  data: { skills: ResourceSkillRow[]; summary: { skills: number; gaps: number; peopleWithoutSkills: number; singlePointSkills: number } } | null;
  onPick: (skill: string) => void;
}) {
  if (!data) return <LoadingBlock label="Loading skills…" />;
  if (data.skills.length === 0) {
    return (
      <EmptyState title="No skills recorded">
        Add skills to people on the <Link to="/resources/team" className="text-[color:var(--accent)] hover:underline">Team</Link> page to see coverage.
      </EmptyState>
    );
  }
  return (
    <SectionCard
      title="Skill coverage"
      description={`${data.summary.gaps} gap${data.summary.gaps === 1 ? '' : 's'} with open demand · ${data.summary.singlePointSkills} held by one person · ${data.summary.peopleWithoutSkills} people without skills`}
    >
      <div className="overflow-x-auto -mx-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <th className="px-6 py-2 font-medium">Skill</th>
              <th className="px-3 py-2 font-medium text-right">People</th>
              <th className="px-3 py-2 font-medium text-right">With room</th>
              <th className="px-3 py-2 font-medium text-right">Open demand</th>
              <th className="px-6 py-2 font-medium">Holders</th>
            </tr>
          </thead>
          <tbody>
            {data.skills.map((s) => (
              <tr key={s.skill} className="border-b border-[color:var(--border-subtle)]/60 align-top">
                <td className="px-6 py-2.5">
                  <button type="button" className="font-medium hover:text-[color:var(--accent)]" onClick={() => onPick(s.skill)}>
                    {s.skill}
                  </button>
                  <div className="flex gap-1 mt-0.5">
                    {s.gap && <Chip tone="bad">gap</Chip>}
                    {s.peopleCount === 1 && <Chip tone="warn">single point</Chip>}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.peopleCount}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums ${s.availablePeople === 0 && s.demands.length ? 'text-red-400' : ''}`}>{s.availablePeople}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {s.demandHours > 0 ? `${s.demandHours}h` : '—'}
                  {s.demands.length > 0 && (
                    <span className="block text-[10px] text-[color:var(--text-muted)]">
                      {s.demands.length} demand{s.demands.length === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
                <td className="px-6 py-2.5">
                  <div className="flex flex-wrap gap-1">
                    {s.people.map((p) => (
                      <Chip key={p.userId} tone={p.available ? 'good' : 'neutral'} title={`${p.committedPercent}% committed`}>
                        {p.name}
                      </Chip>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
