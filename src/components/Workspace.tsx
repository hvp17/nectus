import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Plus, Activity, GitBranch, CheckCircle2, AlertTriangle, CircleCheckBig } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "./ui/card";
import { TaskCard } from "./TaskCard";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import { TaskStatus, TaskSummary, Repo } from "../types";

const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

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
  visibleTasks: TaskSummary[];
  selectedTaskId?: number;
  taskAttention: TaskAttention[];
  onSelectTask: (id: number) => void;
  onRefresh: () => void;
  onCreateTask: () => void;
  onDeleteTask: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  counts: { active: number; dirty: number; review: number; needsInput: number; finished: number };
  busy: boolean;
  loading: boolean;
}

export function Workspace({
  selectedRepo,
  visibleTasks,
  selectedTaskId,
  taskAttention,
  onSelectTask,
  onRefresh,
  onCreateTask,
  onDeleteTask,
  onUpdateStatus,
  counts,
  busy,
  loading,
}: WorkspaceProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<number | undefined>();
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | undefined>();
  const tasksRef = useRef(visibleTasks);
  const busyRef = useRef(busy);
  const lastPointerStatusRef = useRef<TaskStatus | undefined>(undefined);
  const statusHitboxesRef = useRef<StatusHitbox[]>([]);

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

  const moveDroppedTask = useCallback((taskId: number, status: TaskStatus) => {
    const task = getTaskById(taskId);
    clearTaskDrag();
    if (!task) {
      return;
    }
    if (task.status === status) {
      return;
    }
    if (busyRef.current) {
      return;
    }
    onUpdateStatus(task, status);
  }, [clearTaskDrag, getTaskById, onUpdateStatus]);

  const movePointerDroppedTask = useCallback((taskId: number, clientX: number, clientY: number) => {
    const status =
      getStatusFromHitboxes(statusHitboxesRef.current, clientX, clientY) ?? getStatusFromPoint(clientX, clientY);
    lastPointerStatusRef.current = undefined;
    if (!status) {
      clearTaskDrag();
      return;
    }
    moveDroppedTask(taskId, status);
  }, [clearTaskDrag, moveDroppedTask]);

  return (
    <section className="workspace p-10 overflow-auto max-w-[1400px] mx-auto w-full" aria-label="Dashboard workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">Operations</p>
          <h2 className="text-3xl font-bold tracking-tight">
            {selectedRepo ? selectedRepo.name : loading ? "Loading projects..." : "Connect a Project"}
          </h2>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} title="Refresh" className="h-9 gap-2">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <div className="metrics operational-metrics mb-8">
        <Metric icon={<AlertTriangle size={18} />} label="Needs Input" value={counts.needsInput} tone="warning" />
        <Metric icon={<Activity size={18} />} label="Running" value={counts.active} tone="live" />
        <Metric icon={<CircleCheckBig size={18} />} label="Finished" value={counts.finished} tone="success" />
        <Metric icon={<GitBranch size={18} />} label="Dirty" value={counts.dirty} tone="dirty" />
        <Metric icon={<CheckCircle2 size={18} />} label="Review" value={counts.review} />
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-widest opacity-50">Task Board</h3>
        {selectedRepo && (
          <Button type="button" size="sm" onClick={onCreateTask} disabled={busy} className="h-9 gap-2">
            <Plus size={16} />
            New Task
          </Button>
        )}
      </div>

      <div className="columns overflow-x-auto pb-4">
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
              <div className="column-heading px-1 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider">{statusLabels[status]}</span>
                <Badge variant="secondary" className="text-[10px] h-5 min-w-5 justify-center font-bold">
                  {tasksInColumn.length}
                </Badge>
              </div>
              <div className="flex flex-col gap-3">
                {tasksInColumn.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    attention={getTaskAttention(taskAttention, task.id)}
                    isSelected={selectedTaskId === task.id}
                    busy={busy}
                    isDragging={draggingTaskId === task.id}
                    onSelect={onSelectTask}
                    onDelete={onDeleteTask}
                    onDragStart={startTaskDrag}
                    onPointerDragMove={markPointerDragPosition}
                    onPointerDragEnd={movePointerDroppedTask}
                    onDragEnd={clearTaskDrag}
                  />
                ))}
              </div>
            </StatusColumn>
          );
        })}
      </div>
    </section>
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
      className={`status-column min-h-[500px] flex flex-col gap-3 rounded-xl bg-muted/30 p-3 transition-colors ${
        isDropTarget ? "drop-target" : isDropAvailable ? "drop-available" : ""
      }`}
      role="region"
      aria-label={`${statusLabels[status]} tasks`}
      data-task-status={status}
      data-drop-available={isDropAvailable ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
    >
      {children}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warning" | "live" | "success" | "dirty";
}) {
  return (
    <Card size="sm" className="metric border-none bg-muted/30 shadow-none" data-tone={tone}>
      <CardHeader className="flex-row items-center justify-between pb-1">
        <CardTitle className="text-[11px] font-bold uppercase tracking-wider opacity-60">{label}</CardTitle>
        <CardAction className="opacity-40">{icon}</CardAction>
      </CardHeader>
      <CardContent>
        <strong className="text-2xl font-bold tabular-nums">{value}</strong>
      </CardContent>
    </Card>
  );
}
