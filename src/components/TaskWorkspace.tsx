import { Fragment, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  GitBranch,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { GitHubPanel } from "./GitHubPanel";
import { JiraPanel } from "./JiraPanel";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTitle,
  StepperTrigger,
} from "./reui/stepper";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { TerminalPane } from "../TerminalPane";
import { cn } from "../lib/utils";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import {
  REVIEW_LOOP_STATUS_SHORT_LABELS,
  REVIEW_VERDICT_LABELS,
  TASK_STATUS_LABELS,
} from "../statusLabels";
import {
  AgentProfile,
  GithubStatus,
  PullRequestInfo,
  ReviewLoop,
  ReviewRun,
  TaskSummary,
  TaskStatus,
} from "../types";

export interface TaskWorkspaceProps {
  task: TaskSummary | undefined;
  attention?: TaskAttention;
  agentProfiles: AgentProfile[];
  reviewLoop?: ReviewLoop | null;
  reviewRuns: ReviewRun[];
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  pullRequestLoading?: boolean;
  creatingPullRequest?: boolean;
  /** Label for the back affordance, e.g. "Mission Control" or the project name. */
  backLabel?: string;
  onClose: () => void;
  onStopSession: (sessionId: string) => void;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
  onStartReview: (task: TaskSummary, reviewerProfileId: number) => void;
  onCreatePullRequest: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onRefreshPullRequest: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  onDeleteTask: (task: TaskSummary) => void;
  onSetJiraLink: (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) => void;
  /** Connected JIRA site host, used to build the linked story's browse URL. */
  jiraSite?: string | null;
  onSessionExit: (sessionId: string) => void;
  onSessionInput: (sessionId: string) => void;
  busy?: boolean;
  isDeleting?: boolean;
}

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

export function TaskWorkspace({
  task,
  attention,
  agentProfiles,
  reviewLoop,
  reviewRuns,
  githubStatus,
  pullRequest,
  pullRequestLoading = false,
  creatingPullRequest = false,
  backLabel = "Task board",
  onClose,
  onStopSession,
  onResumeSession,
  onStartSession,
  onStartReview,
  onCreatePullRequest,
  onRefreshPullRequest,
  onUpdateStatus,
  onDeleteTask,
  onSetJiraLink,
  jiraSite,
  onSessionExit,
  onSessionInput,
  busy = false,
  isDeleting = false,
}: TaskWorkspaceProps) {
  const reviewerProfiles = useMemo(() => agentProfiles, [agentProfiles]);
  const defaultReviewerProfileId =
    reviewerProfiles.find((profile) => profile.id !== task?.agentProfileId)?.id ?? reviewerProfiles[0]?.id;
  const [reviewerProfileId, setReviewerProfileId] = useState<number | undefined>(
    reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId,
  );

  useEffect(() => {
    setReviewerProfileId(reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId);
  }, [defaultReviewerProfileId, reviewLoop?.reviewerProfileId]);

  if (!task) return null;

  const latestReviewRun = reviewRuns.at(-1);
  const selectedReviewerProfile = reviewerProfiles.find((profile) => profile.id === reviewerProfileId);
  const reviewActive = Boolean(reviewLoop && !["passed", "feedback_sent", "error", "stopped"].includes(reviewLoop.status));
  const reviewInProgress = reviewLoop?.status === "reviewing";
  const canResumeSession = task.agentKind === "codex" || task.agentKind === "claude";
  const sessionAgentLabel = task.lastSessionAgent ?? task.agentName ?? "None";
  const sessionId = task.activeSessionId ?? task.lastSessionId;
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );
  const startReviewDisabled = !selectedReviewerProfile || reviewerProfiles.length === 0 || reviewInProgress;
  const reviewReadyForNextStep = reviewLoop?.status === "passed";
  const githubReady = Boolean(githubStatus?.installed && githubStatus?.authenticated);
  const canCreateViaGithub = Boolean(githubReady && task.hasWorktree && !task.prUrl);
  const canCreatePullRequest = Boolean(!task.prUrl && (canCreateViaGithub || task.activeSessionId));
  const createPullRequestDescription = task.prUrl
    ? "Pull request linked"
    : canCreateViaGithub
      ? "Open a pull request with the GitHub CLI"
      : task.activeSessionId
        ? "Ask the running agent to open a pull request"
        : githubReady
          ? "Add a worktree branch to open a pull request"
          : "Start the agent or connect the GitHub CLI";
  const workflowStep = task.status === "done" || task.prUrl ? 3 : reviewInProgress ? 1 : reviewReadyForNextStep ? 2 : 1;
  const reviewActionLabel = selectedReviewerProfile
    ? `${reviewInProgress ? "Reviewing with" : "Review with"} ${selectedReviewerProfile.name}`
    : "Review with reviewer";
  const startReview = () => {
    if (!reviewerProfileId || startReviewDisabled) return;
    onStartReview(task, reviewerProfileId);
  };
  const workflowSteps = [
    {
      title: reviewInProgress ? "Reviewing..." : "Review",
      description: reviewInProgress
        ? "Reviewer is checking the task"
        : selectedReviewerProfile
          ? `${selectedReviewerProfile.name} will inspect this worktree`
          : "Choose a reviewer profile",
      completed: reviewReadyForNextStep || task.status === "done",
      loading: reviewInProgress,
      disabled: reviewerProfiles.length === 0 || reviewInProgress,
      onClick: undefined as (() => void) | undefined,
    },
    {
      title: "Create PR",
      description: createPullRequestDescription,
      completed: Boolean(task.prUrl),
      loading: false,
      disabled: !canCreatePullRequest,
      onClick: canCreatePullRequest ? () => onCreatePullRequest(task) : undefined,
    },
    {
      title: "Move to done",
      description: task.status === "done" ? "Task is complete" : "Mark task complete",
      completed: task.status === "done",
      loading: false,
      disabled: task.status === "done",
      onClick: () => onUpdateStatus(task, "done"),
    },
  ];

  return (
    <section className="task-workspace grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-background" aria-label="Task workspace">
      {/* ---- stage: header, workflow ribbon, terminal + action bar ---- */}
      <main className="flex min-h-0 min-w-0 flex-col gap-3 bg-gradient-to-b from-muted/25 to-transparent to-30% p-4">
        <header className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Back to task board"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {backLabel}
          </button>
          <h2 className="min-w-0 truncate text-lg font-bold tracking-tight">{task.title}</h2>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <TaskStatusBadges task={task} />
          </div>
        </header>

        {/* the rework: workflow as a horizontal ribbon, always visible above the terminal */}
        <Stepper
          value={workflowStep}
          orientation="horizontal"
          indicators={{
            completed: <Check className="size-3.5" />,
            loading: <LoaderCircle className="size-3.5 animate-spin" />,
          }}
        >
          <StepperNav className="flex w-full items-stretch rounded-lg border bg-card p-1 shadow-xs">
            {workflowSteps.map((step, index) => (
              <Fragment key={step.title}>
                {index > 0 && (
                  <span className="flex w-3.5 shrink-0 select-none items-center justify-center self-center text-border">
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  </span>
                )}
                <StepperItem
                  step={index + 1}
                  completed={step.completed}
                  disabled={step.disabled}
                  loading={step.loading}
                  className="flex-1"
                >
                  <StepperTrigger
                    className="flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left data-[state=active]:bg-primary/10"
                    onClick={step.onClick}
                  >
                    <StepperIndicator className="size-6 rounded-full border-[1.5px] border-border bg-background text-[11px] font-bold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground">
                      {index + 1}
                    </StepperIndicator>
                    <span className="min-w-0">
                      <StepperTitle className="text-[12.5px] font-bold leading-tight data-[state=completed]:text-muted-foreground">
                        {step.title}
                      </StepperTitle>
                      <StepperDescription className="mt-0.5 truncate text-[11px]">
                        {step.description}
                      </StepperDescription>
                    </span>
                  </StepperTrigger>

                  {index === 0 && (
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 pr-1.5">
                      <Button
                        type="button"
                        size="sm"
                        aria-label={reviewActionLabel}
                        disabled={startReviewDisabled}
                        onClick={startReview}
                      >
                        {reviewInProgress && <LoaderCircle data-icon="inline-start" className="animate-spin" />}
                        <span>{reviewInProgress ? "Reviewing" : "Review"}</span>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-label="Change reviewer"
                            className="max-w-[150px]"
                            disabled={reviewActive || reviewerProfiles.length === 0}
                          >
                            {selectedReviewerProfile ? (
                              <>
                                <span aria-hidden="true">
                                  <AgentLogo agentKind={selectedReviewerProfile.agentKind} size="sm" />
                                </span>
                                <span className="truncate">{selectedReviewerProfile.name}</span>
                              </>
                            ) : (
                              <span className="truncate">Reviewer</span>
                            )}
                            <ChevronDown data-icon="inline-end" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuGroup>
                            {reviewerProfiles.map((profile) => (
                              <DropdownMenuItem
                                key={profile.id}
                                onSelect={() => setReviewerProfileId(profile.id)}
                                className="justify-between"
                              >
                                <span className="select-option-with-logo">
                                  <span aria-hidden="true">
                                    <AgentLogo agentKind={profile.agentKind} size="sm" />
                                  </span>
                                  <span className="truncate">{profile.name}</span>
                                </span>
                                {profile.id === reviewerProfileId && <Check className="ml-2 size-3.5 text-primary" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </StepperItem>
              </Fragment>
            ))}
          </StepperNav>
        </Stepper>

        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-lg"
          aria-label="Agent terminal"
        >
          <div className="min-h-0 flex-1 overflow-hidden">
            {task.activeSessionId ? (
              <TerminalPane sessionId={task.activeSessionId} onSessionExit={onSessionExit} onSessionInput={onSessionInput} />
            ) : (
              <TaskTerminalLauncher
                task={task}
                canResumeSession={canResumeSession}
                onResumeSession={onResumeSession}
                onStartSession={onStartSession}
              />
            )}
          </div>

          {attention && (
            <ActionBar
              attention={attention}
              agentName={task.agentName}
              detail={displayedAttentionDetail}
              detailTitle={isAttentionDetailTruncated ? attentionDetail ?? undefined : undefined}
              activeSessionId={task.activeSessionId}
              onStopSession={onStopSession}
            />
          )}
        </section>
      </main>

      {/* ---- calm facts rail ---- */}
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
              {sessionId ? `session ${sessionId}` : "No active session"}
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
                {reviewLoop && (
                  <Badge variant="outline" className="rounded-md">
                    {REVIEW_LOOP_STATUS_SHORT_LABELS[reviewLoop.status]}
                  </Badge>
                )}
              </div>

              {latestReviewRun && (
                <div className="rounded-md border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Review feedback</span>
                    <Badge variant="outline" className="rounded-md">
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
    </section>
  );
}

function ActionBar({
  attention,
  agentName,
  detail,
  detailTitle,
  activeSessionId,
  onStopSession,
}: {
  attention: TaskAttention;
  agentName?: string | null;
  detail?: string | null;
  detailTitle?: string;
  activeSessionId?: string | null;
  onStopSession: (sessionId: string) => void;
}) {
  const needsInput = attention.kind === "needs_input";
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-3 border-t px-3.5 py-3",
        needsInput ? "border-status-warning/30 bg-status-warning/10" : "border-primary/25 bg-primary/5",
      )}
    >
      <span
        className={cn(
          "grid size-[30px] shrink-0 place-items-center rounded-md",
          needsInput ? "bg-status-warning/15 text-status-warning" : "bg-primary/15 text-primary",
        )}
        aria-hidden="true"
      >
        {needsInput ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-bold">{needsInput ? `${agentName ?? "Agent"} needs your decision` : "Agent finished"}</div>
        {detail && (
          <div className="truncate text-xs text-muted-foreground" title={detailTitle}>
            {needsInput ? detail ?? formatAttentionReason(attention.reason) : detail}
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {needsInput && <span className="text-[11px] text-muted-foreground">Reply in the terminal</span>}
        {needsInput && activeSessionId && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            aria-label="Stop session"
            onClick={() => onStopSession(activeSessionId)}
          >
            <Square data-icon="inline-start" fill="currentColor" />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}

function TaskStatusBadges({ task }: { task: TaskSummary }) {
  return (
    <div className="detail-status-row flex flex-wrap gap-1.5">
      <Badge variant="outline" data-status={task.status}>
        {TASK_STATUS_LABELS[task.status]}
      </Badge>
      {task.activeSessionId && (
        <Badge variant="outline" className="border-primary/40 text-primary">
          <span className="dot live-dot bg-primary" aria-hidden="true" />
          Running
        </Badge>
      )}
      {task.isDirty && (
        <Badge variant="outline" className="text-status-info">
          Dirty
        </Badge>
      )}
    </div>
  );
}

function TaskTerminalLauncher({
  task,
  canResumeSession,
  onResumeSession,
  onStartSession,
}: {
  task: TaskSummary;
  canResumeSession: boolean;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
}) {
  const canResume = Boolean(task.lastSessionId && canResumeSession);

  return (
    <div className="terminal-launcher">
      <div className="terminal-launcher-copy">
        <div className="terminal-launcher-kicker">
          <TerminalSquare size={15} />
          <span>{task.lastSessionId ? "Session saved" : "Ready"}</span>
        </div>
        <p className="terminal-launcher-title">No active session</p>
        {task.lastSessionLabel && <p className="terminal-launcher-detail">{task.lastSessionLabel}</p>}
      </div>
      <div className="terminal-launcher-actions">
        {canResume && (
          <Button type="button" variant="outline" aria-label="Resume session" onClick={() => onResumeSession(task)}>
            <RotateCcw data-icon="inline-start" />
            Resume
          </Button>
        )}
        <Button
          type="button"
          aria-label={task.lastSessionId ? "Restart agent" : "Start agent"}
          onClick={() => onStartSession(task)}
        >
          <Play data-icon="inline-start" fill="currentColor" />
          {task.lastSessionId ? "Restart" : "Start"}
        </Button>
      </div>
    </div>
  );
}
