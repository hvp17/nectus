import { useCallback, useEffect, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { RefreshCw, Plus, Activity, GitBranch, CheckCircle2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardHeader, CardTitle, CardContent, CardAction } from "./ui/card";
import { TaskCard } from "./TaskCard";
import { TaskStatus, TaskSummary, Repo } from "../types";

const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

interface WorkspaceProps {
  selectedRepo?: Repo;
  visibleTasks: TaskSummary[];
  selectedTaskId?: number;
  onSelectTask: (id: number) => void;
  onRefresh: () => void;
  onCreateTask: () => void;
  onDeleteTask: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  counts: { active: number; dirty: number; review: number };
  busy: boolean;
  loading: boolean;
  confirmingDeleteTaskId?: number;
}

export function Workspace({
  selectedRepo,
  visibleTasks,
  selectedTaskId,
  onSelectTask,
  onRefresh,
  onCreateTask,
  onDeleteTask,
  onUpdateStatus,
  counts,
  busy,
  loading,
  confirmingDeleteTaskId,
}: WorkspaceProps) {
  const [draggingTaskId, setDraggingTaskId] = useState<number | undefined>();
  const [dropTargetStatus, setDropTargetStatus] = useState<TaskStatus | undefined>();
  const tasksRef = useRef(visibleTasks);
  const busyRef = useRef(busy);

  const draggingTask = visibleTasks.find((task) => task.id === draggingTaskId);

  useEffect(() => {
    tasksRef.current = visibleTasks;
  }, [visibleTasks]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const getTaskById = useCallback((taskId: number) => tasksRef.current.find((task) => task.id === taskId), []);

  const startTaskDrag = useCallback((taskId: number) => {
    setDraggingTaskId(taskId);
  }, []);

  const clearTaskDrag = useCallback(() => {
    setDraggingTaskId(undefined);
    setDropTargetStatus(undefined);
  }, []);

  const moveDroppedTask = useCallback((taskId: number, status: TaskStatus) => {
    const task = getTaskById(taskId);
    clearTaskDrag();
    if (!task || task.status === status || busyRef.current) return;
    onUpdateStatus(task, status);
  }, [clearTaskDrag, getTaskById, onUpdateStatus]);

  return (
    <section className="workspace p-10 overflow-auto max-w-[1400px] mx-auto w-full">
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

      <div className="metrics mb-8">
        <Metric icon={<Activity size={18} />} label="Active Agents" value={counts.active} />
        <Metric icon={<GitBranch size={18} />} label="Dirty Tasks" value={counts.dirty} />
        <Metric icon={<CheckCircle2 size={18} />} label="In Review" value={counts.review} />
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
              getTaskById={getTaskById}
              busyRef={busyRef}
              isDropAvailable={acceptsDraggedTask}
              isDropTarget={acceptsDraggedTask && dropTargetStatus === status}
              onDropTargetChange={setDropTargetStatus}
              onDropTask={moveDroppedTask}
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
                    isSelected={selectedTaskId === task.id}
                    busy={busy}
                    confirmingDelete={confirmingDeleteTaskId === task.id}
                    isDragging={draggingTaskId === task.id}
                    onSelect={onSelectTask}
                    onDelete={onDeleteTask}
                    onDragStart={startTaskDrag}
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
  getTaskById,
  busyRef,
  isDropAvailable,
  isDropTarget,
  onDropTargetChange,
  onDropTask,
  children,
}: {
  status: TaskStatus;
  getTaskById: (taskId: number) => TaskSummary | undefined;
  busyRef: React.MutableRefObject<boolean>;
  isDropAvailable: boolean;
  isDropTarget: boolean;
  onDropTargetChange: (status: TaskStatus | undefined) => void;
  onDropTask: (taskId: number, status: TaskStatus) => void;
  children: React.ReactNode;
}) {
  const columnRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = columnRef.current;
    if (!element) return;

    const getTask = (source: { data: Record<string, unknown> }) => {
      const taskId = Number(source.data.taskId);
      return source.data.type === "task" && Number.isFinite(taskId) ? getTaskById(taskId) : undefined;
    };

    return dropTargetForElements({
      element,
      canDrop: ({ source }) => {
        const task = getTask(source);
        return Boolean(task && task.status !== status && !busyRef.current);
      },
      getDropEffect: () => "move",
      onDragEnter: () => onDropTargetChange(status),
      onDragLeave: () => onDropTargetChange(undefined),
      onDrop: ({ source }) => {
        const task = getTask(source);
        onDropTargetChange(undefined);
        if (task) onDropTask(task.id, status);
      },
    });
  }, [busyRef, getTaskById, onDropTargetChange, onDropTask, status]);

  return (
    <div
      ref={columnRef}
      className={`status-column min-h-[500px] flex flex-col gap-3 rounded-xl bg-muted/30 p-3 transition-colors ${
        isDropTarget ? "drop-target" : isDropAvailable ? "drop-available" : ""
      }`}
      role="region"
      aria-label={`${statusLabels[status]} tasks`}
      data-drop-available={isDropAvailable ? "true" : undefined}
      data-drop-target={isDropTarget ? "true" : undefined}
    >
      {children}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card size="sm" className="metric border-none bg-muted/30 shadow-none">
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
