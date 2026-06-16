import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, GitBranch, Plus, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { Skeleton } from "./ui/skeleton";
import { TaskCard } from "./TaskCard";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import { TASK_STATUS_LABELS } from "../statusLabels";
import { cn } from "../lib/utils";
import { TaskStatus, TaskSummary, Repo } from "../types";

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

/* Board grid: four equal columns on wide windows; below 1280px the columns become
   a horizontally scrolling, scroll-snapping row so card text never gets crushed. */
const boardColsClass =
  "grid min-h-0 flex-1 grid-cols-4 grid-rows-[minmax(0,1fr)] gap-3 max-[1280px]:flex max-[1280px]:items-stretch max-[1280px]:overflow-x-auto max-[1280px]:overflow-y-hidden max-[1280px]:pb-1 max-[1280px]:snap-x max-[1280px]:snap-proximity max-[1280px]:[-webkit-overflow-scrolling:touch]";

const boardColClass =
  "flex min-h-0 flex-col gap-[9px] overflow-hidden rounded-xl bg-muted p-2.5 max-[1280px]:w-[min(272px,calc(100vw_-_108px))] max-[1280px]:flex-[0_0_min(272px,calc(100vw_-_108px))] max-[1280px]:snap-start";

const colHeadClass = "flex flex-none items-center gap-2 px-[3px] pt-[3px] pb-px";
const colLabelClass = "text-[12.5px] font-extrabold tracking-[0.02em]";
const colBodyClass = "flex min-h-0 flex-col gap-[9px] overflow-y-auto";

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
  chatWorkingTaskIds?: Record<number, true>;
  onSelectTask: (id: number) => void;
  onRefresh: () => void;
  onCreateTask: () => void;
  onDeleteTask: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  deletingTaskIds: ReadonlySet<number>;
  busy: boolean;
  loading: boolean;
  /** Archive mode: the board shows archived tasks (restore/delete only). */
  showArchived: boolean;
  onToggleArchived: () => void;
  onUnarchiveTask: (task: TaskSummary) => void;
}

/** The board heading: a workspace name, else the selected repo, else a loading/empty hint. */
function boardHeaderTitle(workspaceName: string | undefined, selectedRepo: Repo | undefined, loading: boolean): string {
  if (workspaceName !== undefined) return workspaceName;
  if (selectedRepo) return selectedRepo.name;
  if (loading) return "Loading projects…";
  return "Connect a project";
}

export function Workspace({
  selectedRepo,
  workspaceName,
  repoNames,
  visibleTasks,
  selectedTaskId,
  taskAttention,
  liveLines,
  chatWorkingTaskIds = {},
  onSelectTask,
  onRefresh,
  onCreateTask,
  onDeleteTask,
  onUpdateStatus,
  deletingTaskIds,
  busy,
  loading,
  showArchived,
  onToggleArchived,
  onUnarchiveTask,
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

  // Bucket once per task-list change instead of filtering per column per render,
  // so the memoized TaskCards keep stable props while live lines stream in.
  const tasksByStatus = useMemo(() => {
    const byStatus = new Map<TaskStatus, TaskSummary[]>(statusOrder.map((status) => [status, []]));
    for (const task of visibleTasks) byStatus.get(task.status)?.push(task);
    return byStatus;
  }, [visibleTasks]);

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
      // Archived tasks are read-only on the board: restore or delete only.
      if (showArchived) return;
      onUpdateStatus(task, status);
    },
    [clearTaskDrag, getTaskById, onUpdateStatus, showArchived],
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
    <main
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-6 py-[22px]"
      aria-label="Project board"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">
            {boardHeaderTitle(workspaceName, selectedRepo, loading)}
          </h1>
          <p className="mt-[3px] text-[13px] text-muted-foreground">
            {showArchived
              ? "Archived tasks — restore them to the board or delete them for good."
              : "Workflow board — Planned through Done, with live state on every card."}
          </p>
        </div>
        <div className="flex flex-none gap-2">
          {(selectedRepo || workspaceName) && (
            <Button
              variant={showArchived ? "secondary" : "outline"}
              size="sm"
              onClick={onToggleArchived}
              aria-pressed={showArchived}
              aria-label={showArchived ? "Back to the board" : "Show archived tasks"}
            >
              <Archive data-icon="inline-start" />
              Archived
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh} title="Refresh">
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
          {(selectedRepo || workspaceName) && !showArchived && (
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
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={boardColsClass}>
            {statusOrder.map((status) => {
              const tasksInColumn = tasksByStatus.get(status) ?? [];
              const acceptsDraggedTask = Boolean(draggingTask && draggingTask.status !== status);
              return (
                <StatusColumn
                  key={status}
                  status={status}
                  isDropAvailable={acceptsDraggedTask}
                  isDropTarget={acceptsDraggedTask && dropTargetStatus === status}
                >
                  <div className={colHeadClass}>
                    <span className={colLabelClass}>{TASK_STATUS_LABELS[status]}</span>
                    <span className="ml-auto grid h-[19px] min-w-5 place-items-center rounded-full bg-card px-1.5 font-mono text-[11px] font-bold text-muted-foreground">
                      {tasksInColumn.length}
                    </span>
                  </div>
                  <div className={colBodyClass}>
                    {tasksInColumn.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        attention={getTaskAttention(taskAttention, task.id)}
                        liveLine={liveLines[task.id]}
                        chatWorking={Boolean(chatWorkingTaskIds[task.id])}
                        repoName={workspaceName ? repoNameById.get(task.repoId) : undefined}
                        isSelected={selectedTaskId === task.id}
                        busy={busy}
                        isDeleting={deletingTaskIds.has(task.id)}
                        isDragging={draggingTaskId === task.id}
                        onSelect={onSelectTask}
                        onUnarchive={showArchived ? onUnarchiveTask : undefined}
                        onDelete={onDeleteTask}
                        onDragStart={startTaskDrag}
                        onPointerDragMove={markPointerDragPosition}
                        onPointerDragEnd={movePointerDroppedTask}
                        onDragEnd={clearTaskDrag}
                      />
                    ))}
                    {tasksInColumn.length === 0 && (
                      <p className="px-2.5 py-[22px] text-center text-[11px] leading-[1.35] text-muted-foreground [overflow-wrap:anywhere]">
                        No {TASK_STATUS_LABELS[status].toLowerCase()} tasks
                      </p>
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
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading tasks">
      <div className={boardColsClass}>
        {statusOrder.map((status) => (
          <div key={status} className={boardColClass}>
            <div className={colHeadClass}>
              <span className={colLabelClass}>{TASK_STATUS_LABELS[status]}</span>
              <Skeleton className="h-5 w-5 rounded-md" />
            </div>
            <div className={colBodyClass}>
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
      className={cn(
        boardColClass,
        "data-[drop-target=true]:outline-2 data-[drop-target=true]:outline-dashed data-[drop-target=true]:-outline-offset-2 data-[drop-target=true]:outline-primary/55",
        "data-[drop-available=true]:bg-[color-mix(in_srgb,var(--primary)_6%,var(--muted))]",
      )}
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
