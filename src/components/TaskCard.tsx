import { AlertTriangle, Bot, CheckCircle2, GitBranch } from "lucide-react";
import { Badge } from "./ui/badge";
import { AgentLogo } from "./AgentBrand";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { deriveAttentionPreview } from "./attentionPreview";
import { useTaskCardPointerDrag } from "../hooks/useTaskCardPointerDrag";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { deriveAgentState } from "../lib/agentState";
import { REVIEW_LOOP_BADGE_VARIANTS, REVIEW_LOOP_STATUS_LABELS } from "../statusLabels";
import type { AgentKind, TaskSummary } from "../types";

interface TaskCardProps {
  task: TaskSummary;
  attention?: TaskAttention;
  /** Latest live activity line for a running session, shown under the title. */
  liveLine?: string;
  /** Repo label shown only on the workspace board to tell cards apart. */
  repoName?: string;
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
  liveLine,
  repoName,
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
  const state = deriveAgentState(task, attention);
  const agentKind: AgentKind = task.agentKind ?? "custom";
  const {
    detail: attentionDetail,
    displayed: displayedAttentionDetail,
    truncated: isAttentionDetailTruncated,
  } = deriveAttentionPreview(attention);
  const reviewStatus = task.reviewLoopStatus ?? undefined;
  const reviewStatusLabel = reviewStatus ? REVIEW_LOOP_STATUS_LABELS[reviewStatus] : undefined;

  return (
    <div
      ref={cardRef}
      className="task-card-shell nx-card group"
      data-state={state}
      data-selected={isSelected ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      aria-grabbed={isDragging}
      role="button"
      tabIndex={0}
      onClick={(event) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onSelect(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(task.id);
        }
      }}
    >
      <div className="nx-card-top">
        <span className="nx-card-title">{task.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {attention?.kind === "needs_input" && (
            <Badge variant="warning" className="font-extrabold h-5 px-1.5 text-[10px]">
              <AlertTriangle size={11} />
              Needs you
            </Badge>
          )}
          {attention?.kind === "idle" && (
            <Badge variant="success" className="font-extrabold h-5 px-1.5 text-[10px]">
              <CheckCircle2 size={11} />
              Done
            </Badge>
          )}
          {task.activeSessionId && attention?.kind !== "needs_input" && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              <span className="nx-badge-dot live-dot" />
              Live
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

      {attention && (
        <div className="nx-card-line" title={isAttentionDetailTruncated ? attentionDetail ?? undefined : undefined}>
          {attention.kind === "needs_input"
            ? `“${attentionDetail ?? formatAttentionReason(attention.reason)}”`
            : displayedAttentionDetail ?? "Agent finished"}
        </div>
      )}

      {!attention && state === "running" && (
        <div className="nx-card-line" data-live="true" title={liveLine || undefined}>
          {liveLine ?? "Working…"}
        </div>
      )}

      {reviewStatus && reviewStatusLabel && (
        <div>
          <Badge
            variant={reviewStatus === "passed" ? "success" : REVIEW_LOOP_BADGE_VARIANTS[reviewStatus]}
            className="max-w-full font-extrabold h-5 px-1.5 text-[10px]"
          >
            {reviewStatus === "passed" && <CheckCircle2 size={11} />}
            {reviewStatusLabel}
          </Badge>
        </div>
      )}

      <div className="nx-card-foot">
        <span className="nx-card-branch">
          {task.hasWorktree ? <GitBranch aria-hidden="true" /> : <Bot aria-hidden="true" />}
          <span className="truncate">{task.hasWorktree ? task.branchName : "No worktree"}</span>
        </span>
        <span className="nx-card-agent">
          {repoName && <span className="nx-card-repo">{repoName}</span>}
          {task.jiraIssueKey && (
            <span className="nx-card-jira" title={task.jiraIssueSummary ?? undefined}>
              {task.jiraIssueKey}
            </span>
          )}
          <AgentLogo agentKind={agentKind} size="xs" />
          {task.hasWorktree && (
            <span className={task.isDirty ? "dirty-indicator" : undefined}>{task.isDirty ? "dirty" : "clean"}</span>
          )}
        </span>
      </div>
    </div>
  );
}
