import { memo } from "react";
import { AlertTriangle, ArchiveRestore, Bot, CheckCircle2, GitBranch } from "lucide-react";
import { Badge } from "./ui/badge";
import { AgentLogo } from "./AgentBrand";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import { deriveAttentionPreview } from "./attentionPreview";
import { useTaskCardPointerDrag } from "../hooks/useTaskCardPointerDrag";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { deriveAgentState } from "../lib/agentState";
import { cn } from "../lib/utils";
import { REVIEW_LOOP_BADGE_VARIANTS, REVIEW_LOOP_STATUS_LABELS } from "../statusLabels";
import type { AgentKind, TaskSummary } from "../types";

interface TaskCardProps {
  task: TaskSummary;
  attention?: TaskAttention;
  /** Latest live activity line for an in-flight ACP chat turn, shown under the title. */
  liveLine?: string;
  /** True while the ACP chat runtime has an in-flight agent turn for this task. */
  chatWorking?: boolean;
  /** Repo label shown only on the workspace board to tell cards apart. */
  repoName?: string;
  isSelected: boolean;
  busy: boolean;
  isDeleting?: boolean;
  isDragging?: boolean;
  onSelect: (id: number) => void;
  /** Archive view only: restore the task to the board. Cards with this set are
   * read-only (no open/drag) — restore or delete are the two actions. */
  onUnarchive?: (task: TaskSummary) => void;
  onDelete: (task: TaskSummary) => void;
  onDragStart: (taskId: number) => void;
  onPointerDragMove: (clientX: number, clientY: number) => void;
  onPointerDragEnd: (taskId: number, clientX: number, clientY: number) => void;
  onDragEnd: () => void;
}

/**
 * Memoized: the board re-renders on every live activity line, but only the card
 * whose `liveLine`/`attention` actually changed should reconcile (the handlers
 * the board passes are useCallback-stable).
 */
export const TaskCard = memo(function TaskCard({
  task,
  attention,
  liveLine,
  chatWorking = false,
  repoName,
  isSelected,
  busy,
  isDeleting = false,
  isDragging = false,
  onSelect,
  onUnarchive,
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
  const state = deriveAgentState(task, attention, chatWorking ? { [task.id]: true } : {});
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
      className={cn(
        "group relative flex w-full flex-none cursor-grab flex-col gap-[9px] overflow-hidden rounded-lg bg-card p-3 pl-3.5 text-left shadow-xs ring-1 ring-border transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-sm hover:ring-primary/45",
        "data-[dragging=true]:opacity-50 data-[selected=true]:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_18%,transparent),var(--shadow-md)] data-[selected=true]:ring-primary",
        // State rail: a 4px colored stripe hugging the card's left edge.
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] data-[state=needs_you]:before:bg-status-warning data-[state=running]:before:bg-primary data-[state=review]:before:bg-status-info data-[state=done]:before:bg-status-success",
      )}
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
        if (onUnarchive) return; // archived cards don't open the workspace
        onSelect(task.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (onUnarchive) return;
          onSelect(task.id);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-[13px] leading-[1.3] font-semibold">{task.title}</span>
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
          {chatWorking && attention?.kind !== "needs_input" && (
            <Badge variant="default" className="h-5 px-1.5 text-[10px]">
              <span className="size-[7px] flex-none animate-pulse rounded-full bg-current" />
              Live
            </Badge>
          )}
          <div className="flex items-center opacity-0 transition-opacity group-hover:opacity-100">
            {onUnarchive && (
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`Restore ${task.title}`}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  onUnarchive(task);
                }}
              >
                <ArchiveRestore size={13} aria-hidden="true" />
              </button>
            )}
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
        <div
          className={cn(
            "truncate font-mono text-[11px] text-muted-foreground",
            state === "needs_you" && "text-[color-mix(in_oklch,var(--status-warning)_55%,var(--foreground))]",
          )}
          title={isAttentionDetailTruncated ? attentionDetail ?? undefined : undefined}
        >
          {attention.kind === "needs_input"
            ? `“${attentionDetail ?? formatAttentionReason(attention.reason)}”`
            : displayedAttentionDetail ?? "Agent finished"}
        </div>
      )}

      {!attention && state === "running" && (
        <div
          className="truncate font-mono text-[11px] text-[color-mix(in_oklch,var(--primary)_32%,var(--muted-foreground))] before:mr-1.5 before:inline-block before:size-1.5 before:animate-pulse before:rounded-full before:bg-primary before:align-middle before:content-['']"
          data-live="true"
          title={liveLine || undefined}
        >
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

      <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold tracking-[0.05em] text-muted-foreground uppercase">
        <span className="flex min-w-0 items-center gap-[5px] overflow-hidden font-mono text-[10.5px] font-medium tracking-normal normal-case">
          {task.hasWorktree ? (
            <GitBranch aria-hidden="true" className="size-[11px] flex-none opacity-70" />
          ) : (
            <Bot aria-hidden="true" className="size-[11px] flex-none opacity-70" />
          )}
          <span className="truncate">{task.hasWorktree ? task.branchName : "No worktree"}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {repoName && (
            <span
              className="rounded-full border border-border px-[5px] py-px font-mono text-[10px] font-semibold text-muted-foreground"
              title={
                task.taskRepos.length > 1
                  ? task.taskRepos.map((taskRepo) => taskRepo.repoName).join(", ")
                  : undefined
              }
            >
              {repoName}
              {task.taskRepos.length > 1 && ` +${task.taskRepos.length - 1}`}
            </span>
          )}
          {task.jiraIssueKey && (
            <span
              className="font-mono text-[10px] font-semibold tracking-normal normal-case"
              title={task.jiraIssueSummary ?? undefined}
            >
              {task.jiraIssueKey}
            </span>
          )}
          <AgentLogo agentKind={agentKind} size="xs" />
          {task.hasWorktree && (
            <span className={task.isDirty ? "text-status-info" : undefined}>{task.isDirty ? "dirty" : "clean"}</span>
          )}
        </span>
      </div>
    </div>
  );
});
