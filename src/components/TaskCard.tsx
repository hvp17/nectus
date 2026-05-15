import { useEffect, useRef } from "react";
import { GitBranch, Bot, Trash2 } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TaskSummary } from "../types";

const DRAG_START_THRESHOLD_PX = 3;

interface TaskCardProps {
  task: TaskSummary;
  isSelected: boolean;
  busy: boolean;
  confirmingDelete: boolean;
  isDragging?: boolean;
  onSelect: (id: number) => void;
  onDelete: (task: TaskSummary) => void;
  onDragStart: (taskId: number) => void;
  onPointerDragMove: (clientX: number, clientY: number) => void;
  onPointerDragEnd: (taskId: number, clientX: number, clientY: number) => void;
  onDragEnd: () => void;
}

export function TaskCard({
  task,
  isSelected,
  busy,
  confirmingDelete,
  isDragging = false,
  onSelect,
  onDelete,
  onDragStart,
  onPointerDragMove,
  onPointerDragEnd,
  onDragEnd,
}: TaskCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const suppressClickRef = useRef(false);
  const deleteDisabled = busy || Boolean(task.activeSessionId);
  const deleteLabel = task.activeSessionId ? "Stop session first" : confirmingDelete ? "Confirm delete" : "Delete task";

  useEffect(() => {
    const element = cardRef.current;
    if (!element || busy) return;

    let startX = 0;
    let startY = 0;
    let pointerId: number | undefined;
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let ghostOffsetX = 0;
    let ghostOffsetY = 0;

    const getClientPosition = (event: PointerEvent) => ({
      clientX: Number.isFinite(event.clientX) ? event.clientX : startX,
      clientY: Number.isFinite(event.clientY) ? event.clientY : startY,
    });

    const moveGhost = (clientX: number, clientY: number) => {
      if (!ghost) return;
      ghost.style.transform = `translate3d(${clientX - ghostOffsetX}px, ${clientY - ghostOffsetY}px, 0) rotate(1deg) scale(0.98)`;
    };

    const removeGhost = () => {
      ghost?.remove();
      ghost = null;
    };

    const createGhost = (clientX: number, clientY: number) => {
      removeGhost();
      const rect = element.getBoundingClientRect();
      ghostOffsetX = clientX - rect.left;
      ghostOffsetY = clientY - rect.top;
      ghost = element.cloneNode(true) as HTMLElement;
      ghost.classList.add("task-drag-ghost");
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.left = "0";
      ghost.style.top = "0";
      ghost.style.transition = "none";
      ghost.style.animation = "none";
      document.body.appendChild(ghost);
      moveGhost(clientX, clientY);
    };

    const stopTracking = () => {
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const { clientX, clientY } = getClientPosition(event);
      const deltaX = clientX - startX;
      const deltaY = clientY - startY;
      if (!dragging && Math.hypot(deltaX, deltaY) < DRAG_START_THRESHOLD_PX) return;

      if (!dragging) {
        dragging = true;
        createGhost(clientX, clientY);
        onDragStart(task.id);
      }

      event.preventDefault();
      moveGhost(clientX, clientY);
      onPointerDragMove(clientX, clientY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stopTracking();

      if (dragging) {
        const { clientX, clientY } = getClientPosition(event);
        event.preventDefault();
        suppressClickRef.current = true;
        removeGhost();
        onPointerDragEnd(task.id, clientX, clientY);
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
    };

    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      stopTracking();
      removeGhost();
      onDragEnd();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button > 0 || (event.target as HTMLElement).closest("button")) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      dragging = false;
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
    };

    element.addEventListener("pointerdown", onPointerDown);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      stopTracking();
      removeGhost();
    };
  }, [busy, onDragEnd, onDragStart, onPointerDragEnd, onPointerDragMove, task.id]);

  return (
    <Card
      ref={cardRef}
      className={`group relative flex flex-col gap-3 p-4 text-left cursor-grab transition-all hover:border-primary/50 active:cursor-grabbing ${
        isSelected ? "border-primary ring-1 ring-primary/20 shadow-md bg-accent/5" : "hover:bg-accent/5"
      } ${isDragging ? "opacity-50 ring-2 ring-primary/30" : ""}`}
      aria-grabbed={isDragging}
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onSelect(task.id);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <strong className="text-sm font-semibold leading-tight line-clamp-2">{task.title}</strong>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.activeSessionId && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px] animate-pulse">
              LIVE
            </Badge>
          )}
          
          <div className={`transition-opacity ${confirmingDelete ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
            <Tooltip open={confirmingDelete || undefined}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 text-destructive hover:bg-destructive/10 ${confirmingDelete ? "bg-destructive/10" : ""}`}
                  disabled={deleteDisabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(task);
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {deleteLabel}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground font-mono">
          {task.hasWorktree ? <GitBranch size={12} className="opacity-70" /> : <Bot size={12} className="opacity-70" />}
          <span className="truncate">{task.hasWorktree ? task.branchName : "No worktree"}</span>
        </div>
        
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
          <span>{task.agentName ?? "No agent"}</span>
          <span>{task.hasWorktree ? (task.isDirty ? "dirty" : "clean") : "task"}</span>
        </div>
      </div>
    </Card>
  );
}
