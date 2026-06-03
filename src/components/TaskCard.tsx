import { GitBranch, Bot, AlertTriangle, CircleCheckBig, Radio } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { useTaskCardPointerDrag } from "../hooks/useTaskCardPointerDrag";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { REVIEW_LOOP_BADGE_VARIANTS, REVIEW_LOOP_STATUS_LABELS } from "../statusLabels";
import type { TaskSummary } from "../types";

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
  const { cardRef, suppressClickRef } = useTaskCardPointerDrag({
    taskId: task.id,
    busy,
    onDragStart,
    onPointerDragMove,
    onPointerDragEnd,
    onDragEnd,
  });
  const cardState = attention?.kind ?? (task.activeSessionId ? "running" : task.isDirty ? "dirty" : "normal");
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );
  const reviewStatus = task.reviewLoopStatus ?? undefined;
  const reviewStatusLabel = reviewStatus ? REVIEW_LOOP_STATUS_LABELS[reviewStatus] : undefined;

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
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              <Radio size={10} />
              LIVE
            </Badge>
          )}

          <div className="opacity-0 transition-opacity group-hover:opacity-100">
            <TaskDeleteDialog
              task={task}
              busy={busy}
              isDeleting={isDeleting}
              onDelete={onDelete}
              buttonClassName="text-destructive hover:bg-destructive/10"
            />
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

        {reviewStatus && reviewStatusLabel && (
          <div className="task-review-line">
            <Badge
              variant={REVIEW_LOOP_BADGE_VARIANTS[reviewStatus]}
              className="task-review-badge h-5 px-1.5 text-[10px]"
              data-status={reviewStatus}
            >
              {reviewStatus === "passed" && <CircleCheckBig size={11} />}
              {reviewStatusLabel}
            </Badge>
          </div>
        )}

        {task.jiraIssueKey && (
          <div className="flex items-center gap-1.5">
            <Badge
              variant="outline"
              className="h-5 px-1.5 font-mono text-[10px]"
              title={task.jiraIssueSummary ?? undefined}
            >
              {task.jiraIssueKey}
            </Badge>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          {task.hasWorktree ? <GitBranch size={12} className="opacity-70" /> : <Bot size={12} className="opacity-70" />}
          <span className={task.hasWorktree ? "truncate font-mono" : "truncate"}>
            {task.hasWorktree ? task.branchName : "No worktree"}
          </span>
        </div>

        <div className="task-card-meta flex items-center justify-between text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
          <span>{task.agentName ?? "No agent"}</span>
          <span className={task.isDirty ? "dirty-indicator" : ""}>
            {task.hasWorktree ? (task.isDirty ? "dirty" : "clean") : "task"}
          </span>
        </div>
      </div>
    </Card>
  );
}
