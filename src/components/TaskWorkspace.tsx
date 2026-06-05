import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  MessageSquareReply,
  Play,
  RotateCcw,
  RotateCw,
  ScanEye,
  Square,
  TerminalSquare,
  XCircle,
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
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { TaskDiffView } from "./TaskDiffView";
import { ReviewTerminalPane } from "./ReviewTerminalPane";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { useTaskDiff } from "../hooks/useTaskDiff";
import { TerminalPane } from "../TerminalPane";
import { cn } from "../lib/utils";
import { openExternal } from "../lib/openExternal";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import {
  REVIEW_LOOP_BADGE_VARIANTS,
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
  /** Live stdout of the task's reviewer, streamed for the read-only Review pane. */
  liveReviewOutput?: string;
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  pullRequestLoading?: boolean;
  creatingPullRequest?: boolean;
  /** Label for the back affordance, e.g. "Mission Control" or the project name. */
  backLabel?: string;
  /** Project/repo name shown in the identity line ("{repo} · session {id}"). */
  repoName?: string;
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
  liveReviewOutput = "",
  githubStatus,
  pullRequest,
  pullRequestLoading = false,
  creatingPullRequest = false,
  backLabel = "Task board",
  repoName,
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

  const diff = useTaskDiff(task?.id);
  const { refresh: refreshDiff } = diff;
  const [stageTab, setStageTab] = useState<"terminal" | "diff" | "review">("terminal");
  // Load (or reload) the diff whenever the Diff tab is shown or the task changes.
  useEffect(() => {
    if (stageTab === "diff") void refreshDiff();
  }, [stageTab, refreshDiff]);

  // Surface the live reviewer the moment a review starts, so "checking progress"
  // is one rising-edge switch away; the user can toggle back at any time.
  const reviewIsRunning = reviewLoop?.status === "reviewing";
  const wasReviewRunning = useRef(false);
  useEffect(() => {
    if (reviewIsRunning && !wasReviewRunning.current) setStageTab("review");
    wasReviewRunning.current = reviewIsRunning;
  }, [reviewIsRunning]);

  if (!task) return null;

  const latestReviewRun = reviewRuns.at(-1);
  // The Review pane shows the live stream while reviewing; once a run finishes it
  // keeps that text (the live buffer equals the final output) and falls back to
  // the last recorded run when there is no live buffer (e.g. a reopened task).
  const reviewOutput =
    liveReviewOutput || (reviewLoop?.status === "reviewing" ? "" : latestReviewRun?.error ?? latestReviewRun?.output ?? "");
  const diffFileCount = diff.summary?.files.length ?? 0;
  // Aggregate line-change totals so the stage header can summarize the diff size
  // next to the Diff toggle (binary files contribute 0 and are simply skipped).
  const diffTotals = (diff.summary?.files ?? []).reduce(
    (totals, file) => {
      totals.additions += file.additions;
      totals.deletions += file.deletions;
      return totals;
    },
    { additions: 0, deletions: 0 },
  );
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
  // Each step carries the inline action shown when it is the CURRENT step. The
  // prototype attaches the action to the active step (Review controls, then the
  // Create PR button, then Move to done), not to a fixed index.
  const reviewAction = (
    <>
      <Button
        type="button"
        size="sm"
        className="h-8"
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
            className="h-8 max-w-[150px]"
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
    </>
  );
  const createPrAction = (
    <Button
      type="button"
      size="sm"
      className="h-8"
      aria-label="Create pull request"
      disabled={!canCreatePullRequest || creatingPullRequest}
      onClick={() => onCreatePullRequest(task)}
    >
      {creatingPullRequest ? (
        <LoaderCircle data-icon="inline-start" className="animate-spin" />
      ) : (
        <GitPullRequest data-icon="inline-start" />
      )}
      Create PR
    </Button>
  );
  const doneAction = (
    <Button
      type="button"
      size="sm"
      className="h-8"
      aria-label="Move to done"
      disabled={task.status === "done"}
      onClick={() => onUpdateStatus(task, "done")}
    >
      <Check data-icon="inline-start" />
      Move to done
    </Button>
  );
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
      action: reviewAction,
    },
    {
      title: "Create PR",
      description: createPullRequestDescription,
      completed: Boolean(task.prUrl),
      loading: false,
      disabled: !canCreatePullRequest,
      action: createPrAction,
    },
    {
      title: "Move to done",
      description: task.status === "done" ? "Task is complete" : "Mark task complete",
      completed: task.status === "done",
      loading: false,
      disabled: task.status === "done",
      action: doneAction,
    },
  ];

  return (
    <section className="task-workspace" aria-label="Task workspace">
      {/* ---- stage: header, workflow ribbon, terminal + action bar ---- */}
      <main className="flex min-h-0 min-w-0 flex-col gap-3 bg-gradient-to-b from-muted/25 to-transparent to-30% p-4">
        <header className="task-workspace-header">
          <div className="task-workspace-heading">
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              onClick={onClose}
              aria-label="Back to task board"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {backLabel}
            </button>
            <h2 className="min-w-0 truncate text-lg font-bold tracking-tight">{task.title}</h2>
          </div>
          <div className="task-workspace-badges">
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
          <StepperNav className="flex w-full items-center rounded-lg border bg-card p-1 shadow-xs">
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
                  <StepperTrigger className="flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left data-[state=active]:bg-primary/[0.11]">
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

                  {index + 1 === workflowStep && step.action && (
                    <div className="ml-auto flex shrink-0 items-center gap-1.5 self-center pr-1.5">
                      {step.action}
                    </div>
                  )}
                </StepperItem>
              </Fragment>
            ))}
          </StepperNav>
        </Stepper>

        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-lg"
          aria-label="Agent workspace stage"
        >
          <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <ToggleGroup
                type="single"
                value={stageTab}
                onValueChange={(value) => value && setStageTab(value as "terminal" | "diff" | "review")}
                variant="outline"
              >
                <ToggleGroupItem value="terminal" aria-label="Show terminal" className="h-7 gap-1.5 px-2.5 text-xs">
                  <TerminalSquare className="size-3.5" aria-hidden="true" />
                  Terminal
                </ToggleGroupItem>
                <ToggleGroupItem value="diff" aria-label="Show diff" className="h-7 gap-1.5 px-2.5 text-xs">
                  <FileDiff className="size-3.5" aria-hidden="true" />
                  Diff
                  {diffFileCount > 0 && (
                    <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px]">
                      {diffFileCount}
                    </Badge>
                  )}
                </ToggleGroupItem>
                <ToggleGroupItem value="review" aria-label="Show reviewer terminal" className="h-7 gap-1.5 px-2.5 text-xs">
                  <ScanEye className="size-3.5" aria-hidden="true" />
                  Review
                  {reviewInProgress && <span className="dot live-dot bg-primary" aria-hidden="true" />}
                </ToggleGroupItem>
              </ToggleGroup>

              {(diffTotals.additions > 0 || diffTotals.deletions > 0) && (
                <span
                  className="flex shrink-0 items-center gap-2 font-mono text-xs font-semibold tabular-nums"
                  aria-label={`${diffTotals.additions} additions, ${diffTotals.deletions} deletions`}
                >
                  <span className="text-status-success">+{diffTotals.additions}</span>
                  <span className="text-destructive">-{diffTotals.deletions}</span>
                </span>
              )}
            </div>

            {stageTab === "diff" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7"
                aria-label="Refresh diff"
                disabled={diff.loading}
                onClick={() => void diff.refresh()}
              >
                <RotateCw data-icon="inline-start" className={cn(diff.loading && "animate-spin")} />
                Refresh
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {stageTab === "diff" ? (
              <TaskDiffView
                summary={diff.summary}
                loading={diff.loading}
                error={diff.error}
                files={diff.files}
                onSelectFile={diff.loadFile}
              />
            ) : stageTab === "review" ? (
              <ReviewTerminalPane output={reviewOutput} active={reviewInProgress} />
            ) : task.activeSessionId ? (
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

          {attention && stageTab === "terminal" && (
            <ActionBar
              attention={attention}
              agentName={task.agentName}
              detail={displayedAttentionDetail}
              detailTitle={isAttentionDetailTruncated ? attentionDetail ?? undefined : undefined}
              prUrl={task.prUrl}
              canCreatePullRequest={canCreatePullRequest}
              onCreatePullRequest={() => onCreatePullRequest(task)}
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
                      onClick={() => setStageTab("review")}
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
    </section>
  );
}

function ActionBar({
  attention,
  agentName,
  detail,
  detailTitle,
  prUrl,
  canCreatePullRequest,
  onCreatePullRequest,
}: {
  attention: TaskAttention;
  agentName?: string | null;
  detail?: string | null;
  detailTitle?: string;
  prUrl?: string | null;
  canCreatePullRequest: boolean;
  onCreatePullRequest: () => void;
}) {
  const needsInput = attention.kind === "needs_input";
  // Reply focuses the live terminal so the user can type their answer inline.
  const focusTerminal = () => {
    if (typeof document === "undefined") return;
    document.querySelector<HTMLTextAreaElement>(".task-workspace .xterm-helper-textarea")?.focus();
  };
  const showOpenPr = Boolean(prUrl || canCreatePullRequest);
  const openPr = () => {
    if (prUrl) openExternal(prUrl);
    else if (canCreatePullRequest) onCreatePullRequest();
  };
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
        {needsInput && (
          <Button type="button" variant="outline" size="sm" onClick={focusTerminal}>
            <MessageSquareReply data-icon="inline-start" />
            Reply
          </Button>
        )}
        {showOpenPr && (
          <Button type="button" size="sm" onClick={openPr}>
            <GitPullRequest data-icon="inline-start" />
            {prUrl ? "Open PR" : "Create PR"}
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
