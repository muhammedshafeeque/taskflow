import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { FiCalendar, FiColumns, FiList, FiPlus, FiSearch } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, usersApi, type CrmDeal, type CrmPipeline, type User } from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import { PersonSelect, toPeople } from '../../components/people';
import { Avatar } from '../../components/dashboard/PmWidgets';
import DealFormModal from './DealFormModal';
import {
  Chip,
  CrmShell,
  DEAL_STATUS_TONE,
  EmptyState,
  LoadingBlock,
  Notice,
  RowMenu,
  Segmented,
  Stat,
  btnPrimary,
  daysUntil,
  dealOrgName,
  errorOf,
  fmtDate,
  inputCls,
  money,
  moneyShort,
  prettyLabel,
  refId,
  refName,
} from './crmKit';

type View = 'board' | 'list';
type StatusFilter = 'open' | 'won' | 'lost' | 'all';
type Sort = 'value' | 'close' | 'updated';

function DealColumn({ stageId, children }: { stageId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `stage:${stageId}` });
  return (
    <div
      ref={setNodeRef}
      className={`space-y-2 min-h-[140px] flex-1 rounded-xl p-1 transition-colors ${
        isOver ? 'bg-[color:var(--accent)]/10 ring-2 ring-[color:var(--accent)]/40' : ''
      }`}
    >
      {children}
    </div>
  );
}

function CloseDate({ deal }: { deal: CrmDeal }) {
  if (!deal.expectedCloseDate) return <span className="text-[color:var(--text-muted)]">No date</span>;
  const d = daysUntil(deal.expectedCloseDate) ?? 0;
  const late = deal.status === 'open' && d < 0;
  return (
    <span className={`inline-flex items-center gap-1 ${late ? 'text-red-400' : 'text-[color:var(--text-muted)]'}`} title={late ? `${-d} days past expected close` : undefined}>
      <FiCalendar className="shrink-0" />
      {fmtDate(deal.expectedCloseDate, { day: 'numeric', month: 'short' })}
    </span>
  );
}

function DealCard({
  deal,
  canDrag,
  onOpen,
  menu,
}: {
  deal: CrmDeal;
  canDrag: boolean;
  onOpen: () => void;
  menu: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal._id, disabled: !canDrag });
  const style = transform ? { transform: CSS.Translate.toString(transform) } : undefined;
  const owner = refName(deal.ownerId);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className={`group rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3 text-sm card-shadow hover:border-[color:var(--accent)]/50 transition ${
        canDrag ? 'cursor-grab active:cursor-grabbing touch-none' : 'cursor-pointer'
      } ${isDragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug line-clamp-2">{deal.title}</p>
          <p className="text-[11px] text-[color:var(--text-muted)] truncate mt-0.5">{dealOrgName(deal)}</p>
        </div>
        <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition -mr-1 -mt-1" onPointerDown={(e) => e.stopPropagation()}>
          {menu}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-semibold tabular-nums">{moneyShort(deal.value, deal.currency)}</span>
        {deal.status !== 'open' ? <Chip tone={DEAL_STATUS_TONE[deal.status]}>{prettyLabel(deal.status)}</Chip> : <span className="text-[11px] text-[color:var(--text-muted)] tabular-nums">{deal.probability}%</span>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
        <CloseDate deal={deal} />
        {owner ? <Avatar name={owner} /> : <span className="text-[color:var(--text-muted)] italic">Unassigned</span>}
      </div>
    </div>
  );
}

export default function CrmDeals() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const canCreate = canAny(user, 'taskflow.crm.deal.create');
  const canUpdate = canAny(user, 'taskflow.crm.deal.update');
  const canDelete = canAny(user, 'taskflow.crm.deal.delete');

  const [pipelines, setPipelines] = useState<CrmPipeline[]>([]);
  const [deals, setDeals] = useState<CrmDeal[] | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CrmDeal | null>(null);
  const [formDefaults, setFormDefaults] = useState<{ stageId?: string; pipelineId?: string } | undefined>();
  const [deleting, setDeleting] = useState<CrmDeal | null>(null);
  const [sort, setSort] = useState<Sort>('value');

  const view = (params.get('view') === 'list' ? 'list' : 'board') as View;
  const search = params.get('q') ?? '';
  const ownerId = params.get('owner') ?? '';
  const status = (params.get('status') ?? 'all') as StatusFilter;
  const setParam = (k: string, v: string, fallback = '') => {
    const next = new URLSearchParams(params);
    if (v && v !== fallback) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    void Promise.all([crmApi.listPipelines(token), crmApi.listDeals(token)]).then(([pRes, dRes]) => {
      if (stale) return;
      if (pRes.success && pRes.data) setPipelines(pRes.data);
      if (dRes.success && dRes.data) setDeals(dRes.data);
      else setNotice(errorOf(dRes, 'Could not load deals.'));
    });
    return () => {
      stale = true;
    };
  }, [token, tick]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
  }, [token]);

  const pipeline = pipelines.find((p) => p._id === params.get('pipeline')) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0] ?? null;
  const stages = useMemo(() => (pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : []), [pipeline]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (deals ?? []).filter((d) => {
      if (pipeline && String(d.pipelineId) !== pipeline._id) return false;
      if (ownerId === 'none' ? refId(d.ownerId) : ownerId && refId(d.ownerId) !== ownerId) return false;
      if (status !== 'all' && d.status !== status) return false;
      if (q && !`${d.title} ${dealOrgName(d)} ${refName(d.contactId)}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [deals, pipeline, search, ownerId, status]);

  const open = filtered.filter((d) => d.status === 'open');
  const openValue = open.reduce((s, d) => s + (d.value ?? 0), 0);
  const weighted = open.reduce((s, d) => s + ((d.value ?? 0) * (d.probability ?? 0)) / 100, 0);
  const overdue = open.filter((d) => (daysUntil(d.expectedCloseDate) ?? 0) < 0).length;
  const currency = deals?.[0]?.currency;

  const moveDeal = async (dealId: string, stageId: string) => {
    if (!token) return;
    const prev = deals;
    setDeals((list) => (list ?? []).map((d) => (d._id === dealId ? { ...d, stageId } : d)));
    const res = await crmApi.moveDealStage(dealId, stageId, token);
    if (!res.success) {
      setDeals(prev);
      setNotice(errorOf(res, 'Could not move the deal.'));
      return;
    }
    load();
  };

  async function onDragEnd(ev: DragEndEvent) {
    setActiveDealId(null);
    if (!canUpdate) return;
    const overId = ev.over?.id ? String(ev.over.id) : '';
    if (!overId.startsWith('stage:')) return;
    const stageId = overId.slice('stage:'.length);
    const deal = deals?.find((d) => d._id === String(ev.active.id));
    if (!deal || String(deal.stageId) === stageId) return;
    await moveDeal(deal._id, stageId);
  }

  async function confirmDelete() {
    if (!token || !deleting) return;
    const res = await crmApi.deleteDeal(deleting._id, token);
    setDeleting(null);
    if (!res.success) return setNotice(errorOf(res, 'Could not delete the deal.'));
    load();
  }

  const openCreate = (stageId?: string) => {
    setEditing(null);
    setFormDefaults({ stageId, pipelineId: pipeline?._id });
    setFormOpen(true);
  };

  const menuFor = (d: CrmDeal) => (
    <RowMenu
      onEdit={canUpdate ? () => { setEditing(d); setFormOpen(true); } : undefined}
      onDelete={canDelete ? () => setDeleting(d) : undefined}
      extra={[{ label: 'Open', onClick: () => navigate(`/crm/deals/${d._id}`) }]}
    />
  );

  if (!deals || !pipeline) return <LoadingBlock label="Loading pipeline…" />;

  const sortedList = [...filtered].sort((a, b) => {
    if (sort === 'close') return new Date(a.expectedCloseDate ?? '9999').getTime() - new Date(b.expectedCloseDate ?? '9999').getTime();
    if (sort === 'updated') return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
    return (b.value ?? 0) - (a.value ?? 0);
  });

  return (
    <CrmShell
      title="Deals"
      description={`${pipeline.name} · ${canUpdate ? 'drag cards between stages, click to open' : 'read-only view'}`}
      actions={
        <>
          <Segmented<View>
            value={view}
            onChange={(v) => setParam('view', v, 'board')}
            options={[
              { value: 'board', label: <span className="inline-flex items-center gap-1"><FiColumns /> Board</span> },
              { value: 'list', label: <span className="inline-flex items-center gap-1"><FiList /> List</span> },
            ]}
          />
          {canCreate && (
            <button type="button" className={btnPrimary} onClick={() => openCreate()}>
              <FiPlus /> New deal
            </button>
          )}
        </>
      }
    >
      <Notice message={notice} onClose={() => setNotice(null)} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Open pipeline" value={moneyShort(openValue, currency)} hint={`${open.length} open deals`} />
        <Stat label="Weighted" value={moneyShort(weighted, currency)} hint="Value × probability" />
        <Stat label="Average deal" value={moneyShort(open.length ? openValue / open.length : 0, currency)} hint="Open deals" />
        <Stat label="Past close date" value={overdue} tone={overdue ? 'bad' : undefined} hint="Open deals overdue" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input value={search} onChange={(e) => setParam('q', e.target.value)} placeholder="Search deals, customers, contacts…" className={`${inputCls} pl-9`} />
        </div>
        <div className="w-56">
          <PersonSelect
            value={ownerId}
            onChange={(v) => setParam('owner', v)}
            people={toPeople(users)}
            specialOptions={[
              { value: '', label: 'All owners' },
              { value: 'none', label: 'Unassigned' },
            ]}
            clearValue=""
            placeholder="Owner"
            size="md"
          />
        </div>
        <Segmented<StatusFilter>
          value={status}
          onChange={(v) => setParam('status', v, 'all')}
          options={(['all', 'open', 'won', 'lost'] as const).map((s) => ({
            value: s,
            label: prettyLabel(s),
            count: (deals ?? []).filter((d) => String(d.pipelineId) === pipeline._id && (s === 'all' || d.status === s)).length,
          }))}
        />
        {pipelines.length > 1 && (
          <select value={pipeline._id} onChange={(e) => setParam('pipeline', e.target.value)} className={`${inputCls} !w-auto`}>
            {pipelines.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {view === 'board' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={({ active }) => setActiveDealId(String(active.id))}
          onDragEnd={(ev) => void onDragEnd(ev)}
          onDragCancel={() => setActiveDealId(null)}
        >
          <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
            {stages.map((stage) => {
              const col = filtered.filter((d) => String(d.stageId) === stage._id);
              const colValue = col.reduce((s, d) => s + (d.value ?? 0), 0);
              const accent = stage.isWon ? 'bg-emerald-500' : stage.isLost ? 'bg-red-500' : 'bg-[color:var(--accent)]';
              return (
                <div key={stage._id} className="w-[270px] shrink-0 flex flex-col rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-2.5">
                  <div className={`h-1 rounded-full ${accent} opacity-70 mb-2`} />
                  <div className="flex items-start justify-between gap-2 px-1 mb-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-sm truncate">{stage.name}</h3>
                      <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">
                        {col.length} · {moneyShort(colValue, currency)} · {stage.probability}%
                      </p>
                    </div>
                    {canCreate && !stage.isWon && !stage.isLost && (
                      <button type="button" onClick={() => openCreate(stage._id)} className="p-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--bg-elevated)]" aria-label={`Add deal to ${stage.name}`}>
                        <FiPlus />
                      </button>
                    )}
                  </div>
                  <DealColumn stageId={stage._id}>
                    {col.map((deal) => (
                      <DealCard key={deal._id} deal={deal} canDrag={canUpdate} onOpen={() => navigate(`/crm/deals/${deal._id}`)} menu={menuFor(deal)} />
                    ))}
                    {col.length === 0 && <p className="text-[11px] text-center text-[color:var(--text-muted)] py-6">Drop deals here</p>}
                  </DealColumn>
                </div>
              );
            })}
          </div>
          <DragOverlay>
            {activeDealId ? (
              <div className="rounded-xl border border-[color:var(--accent)]/40 bg-[color:var(--bg-elevated)] p-3 text-sm shadow-xl w-[250px] rotate-2">
                <p className="font-medium">{deals.find((d) => d._id === activeDealId)?.title}</p>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : sortedList.length === 0 ? (
        <EmptyState title="No deals match">Try clearing the search or filters.</EmptyState>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left border-b border-[color:var(--border-subtle)]">
                <th className="py-2.5 px-4 font-medium">Deal</th>
                <th className="py-2.5 px-3 font-medium">Stage</th>
                <th className="py-2.5 px-3 font-medium">Owner</th>
                <SortTh label="Value" active={sort === 'value'} onClick={() => setSort('value')} right />
                <th className="py-2.5 px-3 font-medium text-right hidden md:table-cell">Prob.</th>
                <SortTh label="Close" active={sort === 'close'} onClick={() => setSort('close')} />
                <SortTh label="Updated" active={sort === 'updated'} onClick={() => setSort('updated')} className="hidden lg:table-cell" />
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border-subtle)]">
              {sortedList.map((d) => (
                <tr key={d._id} className="hover:bg-[color:var(--bg-elevated)]/60">
                  <td className="py-2.5 px-4">
                    <Link to={`/crm/deals/${d._id}`} className="font-medium hover:text-[color:var(--accent)]">
                      {d.title}
                    </Link>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">{dealOrgName(d)}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="inline-flex items-center gap-1.5">
                      {stages.find((s) => s._id === String(d.stageId))?.name ?? '—'}
                      {d.status !== 'open' && <Chip tone={DEAL_STATUS_TONE[d.status]}>{prettyLabel(d.status)}</Chip>}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-[color:var(--text-muted)]">{refName(d.ownerId) || '—'}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(d.value, d.currency)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums hidden md:table-cell">{d.probability}%</td>
                  <td className="py-2.5 px-3 text-xs">
                    <CloseDate deal={d} />
                  </td>
                  <td className="py-2.5 px-3 text-xs text-[color:var(--text-muted)] hidden lg:table-cell">{fmtDate(d.updatedAt, { day: 'numeric', month: 'short' })}</td>
                  <td className="py-2.5 pr-3 text-right">{menuFor(d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DealFormModal
        open={formOpen}
        deal={editing}
        pipelines={pipelines}
        defaults={formDefaults}
        onClose={() => setFormOpen(false)}
        onSaved={(saved) => {
          setFormOpen(false);
          if (!editing && saved?._id) navigate(`/crm/deals/${saved._id}`);
          else load();
        }}
      />
      <ConfirmModal
        open={!!deleting}
        title="Delete deal?"
        message={`“${deleting?.title ?? ''}” and its activities will be deleted. Linked quotes and contracts are kept.`}
        confirmLabel="Delete deal"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </CrmShell>
  );
}

function SortTh({ label, active, onClick, right, className = '' }: { label: string; active: boolean; onClick: () => void; right?: boolean; className?: string }) {
  return (
    <th className={`py-2.5 px-3 font-medium ${right ? 'text-right' : ''} ${className}`}>
      <button type="button" onClick={onClick} className={`uppercase tracking-wider ${active ? 'text-[color:var(--text-primary)]' : 'hover:text-[color:var(--text-primary)]'}`}>
        {label}
        {active && ' ↓'}
      </button>
    </th>
  );
}
