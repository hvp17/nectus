import { useEffect, useRef, useState } from "react";
import { GitBranch, Bot, Trash2, AlertTriangle, CircleCheckBig, Radio } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { TaskSummary } from "../types";

const DRAG_START_THRESHOLD_PX = 3;
const TASK_DRAG_SELECTION_LOCK_CLASS = "task-drag-selection-lock";

interface TaskCardProps {
  task: TaskSummary;
  attention?: TaskAttention;
  isSelected: boolean;
  busy: boolean;
  isDeleting?: boolean;
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
  attention,
  isSelected,
  busy,
  isDeleting = false,
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
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteDisabled = busy || isDeleting || Boolean(task.activeSessionId);
  const deleteLabel = task.activeSessionId ? "Stop session first" : isDeleting ? "Deleting task" : "Delete task";
  const deleteDescription = task.hasWorktree
    ? `This removes "${task.title}" and its worktree from Nectus and disk.`
    : `This removes "${task.title}" from Nectus. No files are deleted.`;
  const cardState = attention?.kind ?? (task.activeSessionId ? "running" : task.isDirty ? "dirty" : "normal");
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );

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
    let selectionLocked = false;

    const lockPageSelection = () => {
      selectionLocked = true;
      document.body.classList.add(TASK_DRAG_SELECTION_LOCK_CLASS);
    };

    const unlockPageSelection = () => {
      if (!selectionLocked) return;
      selectionLocked = false;
      document.body.classList.remove(TASK_DRAG_SELECTION_LOCK_CLASS);
    };

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
      unlockPageSelection();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      event.preventDefault();

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
      lockPageSelection();
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
      className={`task-card-shell group relative flex flex-col gap-3 p-4 text-left cursor-grab transition-all hover:border-primary/50 active:cursor-grabbing ${
        isSelected ? "border-primary ring-1 ring-primary/20 shadow-md bg-accent/5" : "hover:bg-accent/5"
      } ${isDragging ? "opacity-50 ring-2 ring-primary/30" : ""}`}
      data-state={cardState}
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
      <span className="task-state-rail" aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <strong className="text-sm font-semibold leading-tight line-clamp-2">{task.title}</strong>
        <div className="flex items-center gap-1.5 shrink-0">
          {attention?.kind === "needs_input" && (
            <Badge variant="secondary" className="attention-badge h-5 px-1.5 text-[10px]">
              <AlertTriangle size={11} />
              INPUT
            </Badge>
          )}
          {attention?.kind === "idle" && (
            <Badge variant="secondary" className="attention-badge h-5 px-1.5 text-[10px]">
              <CircleCheckBig size={11} />
              DONE
            </Badge>
          )}
          {task.activeSessionId && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px] animate-pulse">
              <Radio size={10} />
              LIVE
            </Badge>
          )}
          
          <div className="opacity-0 transition-opacity group-hover:opacity-100">
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:bg-destructive/10"
                      disabled={deleteDisabled}
                      aria-label={deleteLabel}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </AlertDialogTrigger>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {deleteLabel}
                </TooltipContent>
              </Tooltip>
              <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogMedia className="bg-destructive/10 text-destructive">
                    <Trash2 size={16} />
                  </AlertDialogMedia>
                  <AlertDialogTitle>Delete task?</AlertDialogTitle>
                  <AlertDialogDescription>{deleteDescription}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      setDeleteDialogOpen(false);
                      onDelete(task);
                    }}
                  >
                    Delete Task
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-auto">
        {attention && (
          <div className="task-attention-line">
            {attention.kind === "needs_input" ? formatAttentionReason(attention.reason) : "Agent finished"}
            {attentionDetail && (
              <span className="task-attention-detail" title={isAttentionDetailTruncated ? attentionDetail : undefined}>
                {displayedAttentionDetail}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground font-mono">
          {task.hasWorktree ? <GitBranch size={12} className="opacity-70" /> : <Bot size={12} className="opacity-70" />}
          <span className="truncate">{task.hasWorktree ? task.branchName : "No worktree"}</span>
        </div>
        
        <div className="task-card-meta flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground/60">
          <span>{task.agentName ?? "No agent"}</span>
          <span className={task.isDirty ? "dirty-indicator" : ""}>
            {task.hasWorktree ? (task.isDirty ? "dirty" : "clean") : "task"}
          </span>
        </div>
      </div>
    </Card>
  );
}
