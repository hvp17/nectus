import { CheckCircle2, GitBranch, ScanEye, Square, XCircle } from "lucide-react";
import { AgentLogo } from "../AgentBrand";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { GitHubPanel } from "../GitHubPanel";
import { JiraPanel } from "../JiraPanel";
import { TaskDeleteDialog } from "../TaskDeleteDialog";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import {
  REVIEW_LOOP_BADGE_VARIANTS,
  REVIEW_LOOP_STATUS_SHORT_LABELS,
  REVIEW_VERDICT_LABELS,
  TASK_STATUS_LABELS,
} from "../../statusLabels";
import {
  GithubStatus,
  PullRequestInfo,
  ReviewLoop,
  ReviewRun,
  TaskSummary,
  TaskStatus,
} from "../../types";

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

export interface TaskWorkspaceFactsRailProps {
  task: TaskSummary;
  repoName?: string;
  sessionId?: string | null;
  sessionAgentLabel: string;
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  pullRequestLoading?: boolean;
  creatingPullRequest?: boolean;
  reviewLoop?: ReviewLoop | null;
  latestReviewRun?: ReviewRun;
  reviewInProgress: boolean;
  /** Whether there is any reviewer output (live or recorded) to view. */
  reviewOutput: string;
  jiraSite?: string | null;
  busy?: boolean;
  isDeleting?: boolean;
  onStopSession: (sessionId: string) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  onCreatePullRequest: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onRefreshPullRequest: (task: TaskSummary) => void;
  onSetJiraLink: (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) => void;
  onDeleteTask: (task: TaskSummary) => void;
  /** Opens the read-only reviewer terminal on the stage. */
  onWatchReview: () => void;
}

/// The calm inspector rail: agent identity, task metadata, GitHub/JIRA panels,
/// the review summary card, the brief, and delete.
export function TaskWorkspaceFactsRail({
  task,
  repoName,
  sessionId,
  sessionAgentLabel,
  githubStatus,
  pullRequest,
  pullRequestLoading = false,
  creatingPullRequest = false,
  reviewLoop,
  latestReviewRun,
  reviewInProgress,
  reviewOutput,
  jiraSite,
  busy = false,
  isDeleting = false,
  onStopSession,
  onUpdateStatus,
  onCreatePullRequest,
  onRefreshPullRequest,
  onSetJiraLink,
  onDeleteTask,
  onWatchReview,
}: TaskWorkspaceFactsRailProps) {
  return (
    <aside
      className="flex min-w-0 flex-col overflow-hidden border-l bg-[color-mix(in_srgb,var(--card)_74%,var(--background))]"
      aria-label="Task inspector"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-card shadow-xs">
          <AgentLogo agentKind={task.agentKind ?? "custom"} size="md" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-[13px] font-bold">{sessionAgentLabel}</strong>
          <small className="block truncate text-[11px] text-muted-foreground">
            {[repoName, sessionId ? `session ${sessionId}` : "No active session"].filter(Boolean).join(" · ")}
          </small>
        </span>
        {task.activeSessionId && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="ml-auto"
            aria-label="Stop session"
            onClick={() => onStopSession(task.activeSessionId!)}
          >
            <Square data-icon="inline-start" fill="currentColor" />
            Stop
          </Button>
        )}
      </div>

      <div data-testid="task-detail-body" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <section className="flex flex-col gap-2.5 border-b px-4 py-3.5" aria-label="Task metadata">
          <div className="flex items-center justify-between gap-2.5 text-xs">
            <span className="text-muted-foreground">Status</span>
            <Select value={task.status} onValueChange={(val) => onUpdateStatus(task, val as TaskStatus)}>
              <SelectTrigger
                aria-label="Task status"
                className="h-7 w-fit border-none bg-accent/50 text-xs font-medium hover:bg-accent focus:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {statusOrder.map((status) => (
                    <SelectItem key={status} value={status} className="text-xs">
                      {TASK_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2.5 text-xs">
            <span className="text-muted-foreground">Mode</span>
            <Badge variant="outline">{task.hasWorktree ? "Worktree" : "Task only"}</Badge>
          </div>

          {task.hasWorktree && task.branchName && (
            <div className="flex items-center justify-between gap-2.5 text-xs">
              <span className="text-muted-foreground">Branch</span>
              <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]" title={task.branchName}>
                <GitBranch className="size-3 shrink-0 opacity-70" />
                <span className="truncate">{task.branchName}</span>
              </span>
            </div>
          )}

          {task.hasWorktree && task.worktreePath && (
            <div className="flex items-center justify-between gap-2.5 text-xs">
              <span className="shrink-0 text-muted-foreground">Worktree</span>
              <span className="truncate font-mono text-[11.5px] text-muted-foreground" title={task.worktreePath}>
                {task.worktreePath}
              </span>
            </div>
          )}
        </section>

        <div className="border-b px-4 py-3.5">
          <GitHubPanel
            task={task}
            githubStatus={githubStatus}
            pullRequest={pullRequest}
            pullRequestLoading={pullRequestLoading}
            creatingPullRequest={creatingPullRequest}
            onCreatePullRequest={onCreatePullRequest}
            onRefreshPullRequest={onRefreshPullRequest}
          />
        </div>

        {task.jiraIssueKey && (
          <div className="border-b px-4 py-3.5">
            <JiraPanel task={task} site={jiraSite} onSetJiraLink={onSetJiraLink} />
          </div>
        )}

        {(reviewLoop || latestReviewRun) && (
          <section className="flex flex-col gap-2.5 border-b px-4 py-3.5" aria-label="Task review">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Review</p>
              <div className="flex items-center gap-1.5">
                {(reviewInProgress || reviewOutput) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    aria-label="Open reviewer terminal"
                    onClick={onWatchReview}
                  >
                    <ScanEye data-icon="inline-start" />
                    {reviewInProgress ? "Watch live" : "View output"}
                  </Button>
                )}
                {reviewLoop && (
                  <Badge variant={REVIEW_LOOP_BADGE_VARIANTS[reviewLoop.status]} className="rounded-md">
                    {REVIEW_LOOP_STATUS_SHORT_LABELS[reviewLoop.status]}
                  </Badge>
                )}
              </div>
            </div>

            {latestReviewRun && (
              <div className="rounded-md border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">Review feedback</span>
                  <Badge
                    variant={
                      latestReviewRun.verdict === "pass"
                        ? "success"
                        : latestReviewRun.verdict === "needs_changes"
                          ? "destructive"
                          : "outline"
                    }
                    className="rounded-md"
                  >
                    {latestReviewRun.verdict === "pass" && <CheckCircle2 data-icon="inline-start" />}
                    {latestReviewRun.verdict === "needs_changes" && <XCircle data-icon="inline-start" />}
                    {REVIEW_VERDICT_LABELS[latestReviewRun.verdict]}
                  </Badge>
                </div>
                <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
                  {latestReviewRun.error ?? latestReviewRun.output}
                </p>
              </div>
            )}
          </section>
        )}

        {task.prompt && (
          <section className="flex flex-col gap-1.5 border-b px-4 py-3.5" aria-label="Task brief">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">Brief</p>
            <p className="text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">{task.prompt}</p>
          </section>
        )}

        <div className="mt-auto flex items-center justify-end px-4 py-3.5">
          <TaskDeleteDialog
            task={task}
            busy={busy}
            isDeleting={isDeleting}
            onDelete={onDeleteTask}
            buttonVariant="destructive"
            buttonSize="sm"
            showButtonText
          />
        </div>
      </div>
    </aside>
  );
}
