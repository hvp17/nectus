import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, Plus, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { TaskCard } from "./TaskCard";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import { TASK_STATUS_LABELS } from "../statusLabels";
import { TaskStatus, TaskSummary, Repo } from "../types";

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

interface StatusHitbox {
  status: TaskStatus;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getStatusHitboxes(): StatusHitbox[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-task-status]")).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      status: element.dataset.taskStatus as TaskStatus,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
    };
  });
}

function getStatusFromHitboxes(hitboxes: StatusHitbox[], clientX: number, clientY: number): TaskStatus | undefined {
  return hitboxes.find(
    (hitbox) =>
      clientX >= hitbox.left &&
      clientX <= hitbox.right &&
      clientY >= hitbox.top &&
      clientY <= hitbox.bottom,
  )?.status;
}

function getStatusFromPoint(clientX: number, clientY: number): TaskStatus | undefined {
  if (!document.elementsFromPoint) return undefined;
  return document
    .elementsFromPoint(clientX, clientY)
    .map((element) => element.closest<HTMLElement>("[data-task-status]"))
    .find((element): element is HTMLElement => Boolean(element))?.dataset.taskStatus as TaskStatus | undefined;
}

interface WorkspaceProps {
  selectedRepo?: Repo;
  /** When set, this board is a workspace board: header shows the name, cards show repo badges. */
  workspaceName?: string;
  /** All repos, used to label cards with their project name on the workspace board. */
  repoNames?: Repo[];
  visibleTasks: TaskSummary[];
  selectedTaskId?: number;
  taskAttention: TaskAttention[];
  liveLines: Record<number, string>;
  onSelectTask: (id: number) => void;
  onRefresh: () => void;
  onCreateTask: () => void;
  onDeleteTask: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  deletingTaskIds: ReadonlySet<number>;
  busy: boolean;
  loading: boolean;
}

export function Workspace({
  selectedRepo,
  workspaceName,
  repoNames,
  visibleTasks,
  selectedTaskId,
  taskAttention,
  liveLines,
  onSelectTask,
  onRefresh,
  onCreateTask,
  onDeleteTask,
  onUpdateStatus,
  deletingTaskIds,
  busy,
  loading,
}: WorkspaceProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<number | undefined>();
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | undefined>();
  const tasksRef = useRef(visibleTasks);
  const busyRef = useRef(busy);
  const lastPointerStatusRef = useRef<TaskStatus | undefined>(undefined);
  const statusHitboxesRef = useRef<StatusHitbox[]>([]);

  const repoNameById = useMemo(
    () => new Map((repoNames ?? []).map((repo) => [repo.id, repo.name])),
    [repoNames],
  );

  const draggingTask = visibleTasks.find((task) => task.id === draggingTaskId);

  useEffect(() => {
    tasksRef.current = visibleTasks;
  }, [visibleTasks]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const getTaskById = useCallback((taskId: number) => tasksRef.current.find((task) => task.id === taskId), []);

  const startTaskDrag = useCallback((taskId: number) => {
    statusHitboxesRef.current = getStatusHitboxes();
    setDraggingTaskId(taskId);
  }, []);

  const clearTaskDrag = useCallback(() => {
    setDraggingTaskId(undefined);
    setDropTargetStatus(undefined);
    lastPointerStatusRef.current = undefined;
    statusHitboxesRef.current = [];
  }, []);

  const markPointerDragPosition = useCallback((clientX: number, clientY: number) => {
    const status =
      getStatusFromHitboxes(statusHitboxesRef.current, clientX, clientY) ?? getStatusFromPoint(clientX, clientY);
    if (status === lastPointerStatusRef.current) return;
    lastPointerStatusRef.current = status;
    setDropTargetStatus(status);
  }, []);

  const moveDroppedTask = useCallback(
    (taskId: number, status: TaskStatus) => {
      const task = getTaskById(taskId);
      clearTaskDrag();
      if (!task) return;
      if (task.status === status) return;
      if (busyRef.current) return;
      onUpdateStatus(task, status);
    },
    [clearTaskDrag, getTaskById, onUpdateStatus],
  );

  const movePointerDroppedTask = useCallback(
    (taskId: number, clientX: number, clientY: number) => {
      const status =
        getStatusFromHitboxes(statusHitboxesRef.current, clientX, clientY) ?? getStatusFromPoint(clientX, clientY);
      lastPointerStatusRef.current = undefined;
      if (!status) {
        clearTaskDrag();
        return;
      }
      moveDroppedTask(taskId, status);
    },
    [clearTaskDrag, moveDroppedTask],
  );

  return (
    <main className="nx-main" aria-label="Project board">
      <div className="nx-head-row">
        <div>
          <h1 className="nx-h1">
            {workspaceName ?? (selectedRepo ? selectedRepo.name : loading ? "Loading projects…" : "Connect a project")}
          </h1>
          <p className="nx-sub">Workflow board — Planned through Done, with live state on every card.</p>
        </div>
        <div className="nx-head-actions">
          <Button variant="outline" size="sm" onClick={onRefresh} title="Refresh">
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
          {(selectedRepo || workspaceName) && (
            <Button type="button" size="sm" onClick={onCreateTask} disabled={busy}>
              <Plus data-icon="inline-start" />
              New Task
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <BoardSkeleton />
      ) : !selectedRepo && !workspaceName ? (
        <Empty className="min-h-[360px] border bg-muted/20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitBranch size={16} />
            </EmptyMedia>
            <EmptyTitle>Connect a project</EmptyTitle>
            <EmptyDescription>Add an existing local git repo from the Projects panel.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="nx-board">
          <div className="nx-cols">
            {statusOrder.map((status) => {
              const tasksInColumn = visibleTasks.filter((t) => t.status === status);
              const acceptsDraggedTask = Boolean(draggingTask && draggingTask.status !== status);
              return (
                <StatusColumn
                  key={status}
                  status={status}
                  isDropAvailable={acceptsDraggedTask}
                  isDropTarget={acceptsDraggedTask && dropTargetStatus === status}
                >
                  <div className="nx-col-head">
                    <span className="nx-cl">{TASK_STATUS_LABELS[status]}</span>
                    <span className="nx-cc">{tasksInColumn.length}</span>
                  </div>
                  <div className="nx-col-body">
                    {tasksInColumn.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        attention={getTaskAttention(taskAttention, task.id)}
                        liveLine={liveLines[task.id]}
                        repoName={workspaceName ? repoNameById.get(task.repoId) : undefined}
                        isSelected={selectedTaskId === task.id}
                        busy={busy}
                        isDeleting={deletingTaskIds.has(task.id)}
                        isDragging={draggingTaskId === task.id}
                        onSelect={onSelectTask}
                        onDelete={onDeleteTask}
                        onDragStart={startTaskDrag}
                        onPointerDragMove={markPointerDragPosition}
                        onPointerDragEnd={movePointerDroppedTask}
                        onDragEnd={clearTaskDrag}
                      />
                    ))}
                    {tasksInColumn.length === 0 && (
                      <p className="nx-col-empty">No {TASK_STATUS_LABELS[status].toLowerCase()} tasks</p>
                    )}
                  </div>
                </StatusColumn>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

function BoardSkeleton() {
  return (
    <div className="nx-board" aria-busy="true" aria-label="Loading tasks">
      <div className="nx-cols">
        {statusOrder.map((status) => (
          <div key={status} className="nx-col">
            <div className="nx-col-head">
              <span className="nx-cl">{TASK_STATUS_LABELS[status]}</span>
              <Skeleton className="h-5 w-5 rounded-md" />
            </div>
            <div className="nx-col-body">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusColumn({
  status,
  isDropAvailable,
  isDropTarget,
  children,
}: {
  status: TaskStatus;
  isDropAvailable: boolean;
  isDropTarget: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="nx-col"
      role="region"
      aria-label={`${TASK_STATUS_LABELS[status]} tasks`}
      data-task-status={status}
      data-drop-available={isDropAvailable ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
    >
      {children}
    </div>
  );
}
