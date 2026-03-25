import { useState } from 'react';
import { DndContext, DragOverlay, pointerWithin, type DragEndEvent } from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { KanbanScrollArea } from './KanbanScrollArea';
import { KanbanDragPreview } from './KanbanDragPreview';
import type { Issue } from '../../lib/api';

type MetaGetter = (name: string) => { icon?: string; color?: string } | undefined;

interface IssuesKanbanViewProps {
  issues: Issue[];
  statusList: string[];
  projectId: string | undefined;
  getIssueKey: (issue: Issue) => string;
  getStatusMeta: MetaGetter;
  getTypeMeta: MetaGetter;
  getPriorityMeta: MetaGetter;
  openEdit: (issue: Issue) => void;
  setConfirmDeleteIssue: (issue: Issue | null) => void;
  kanbanUpdatingId: string | null;
  kanbanError: string | null;
  handleKanbanDragEnd: (ev: DragEndEvent) => void | Promise<void>;
  kanbanSensors: ReturnType<typeof import('@dnd-kit/core').useSensors>;
  watchingStatus: Record<string, boolean>;
  watchingLoadingId: string | null;
  handleToggleWatch: (issueId: string) => void;
}

export function IssuesKanbanView({
  issues,
  statusList,
  projectId,
  getIssueKey,
  getStatusMeta,
  getTypeMeta,
  getPriorityMeta,
  openEdit,
  setConfirmDeleteIssue,
  kanbanUpdatingId,
  kanbanError,
  handleKanbanDragEnd,
  kanbanSensors,
  watchingStatus,
  watchingLoadingId,
  handleToggleWatch,
}: IssuesKanbanViewProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIssue = activeId ? issues.find((i) => i._id === activeId) : undefined;

  async function handleDragEnd(ev: DragEndEvent) {
    setActiveId(null);
    await handleKanbanDragEnd(ev);
  }

  return (
    <div className="space-y-2">
      {kanbanError && (
        <p className="text-sm text-red-400" role="alert">{kanbanError}</p>
      )}
      <DndContext
        sensors={kanbanSensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <KanbanScrollArea>
          {statusList.map((status) => {
            const columnIssues = issues.filter((i) => i.status === status);
            return (
              <KanbanColumn key={status} status={status} count={columnIssues.length} getStatusMeta={getStatusMeta}>
                {columnIssues.map((issue) => (
                  <KanbanCard
                    key={issue._id}
                    issue={issue}
                    projectId={projectId}
                    getIssueKey={getIssueKey}
                    getTypeMeta={getTypeMeta}
                    getPriorityMeta={getPriorityMeta}
                    openEdit={openEdit}
                    setConfirmDeleteIssue={setConfirmDeleteIssue}
                    isUpdating={kanbanUpdatingId === issue._id}
                    watching={watchingStatus[issue._id]}
                    watchingLoading={watchingLoadingId === issue._id}
                    onToggleWatch={() => handleToggleWatch(issue._id)}
                  />
                ))}
              </KanbanColumn>
            );
          })}
        </KanbanScrollArea>
        <DragOverlay dropAnimation={null}>
          {activeIssue ? (
            <KanbanDragPreview issueKey={getIssueKey(activeIssue)} title={activeIssue.title} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
