import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheckBig,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TaskDeleteDialog } from "./TaskDeleteDialog";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "./reui/stepper";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { TerminalPane } from "../TerminalPane";
import { cn } from "../lib/utils";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { AgentProfile, ReviewLoop, ReviewRun, TaskSummary, TaskStatus } from "../types";

export interface TaskWorkspaceProps {
  task: TaskSummary | undefined;
  attention?: TaskAttention;
  agentProfiles: AgentProfile[];
  reviewLoop?: ReviewLoop | null;
  reviewRuns: ReviewRun[];
  onClose: () => void;
  onStopSession: (sessionId: string) => void;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
  onStartReview: (task: TaskSummary, reviewerProfileId: number) => void;
  onCreatePullRequest: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  onDeleteTask: (task: TaskSummary) => void;
  onSessionExit: (sessionId: string) => void;
  onSessionInput: (sessionId: string) => void;
  busy?: boolean;
  isDeleting?: boolean;
}

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];
const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};
const reviewLoopStatusLabels: Record<ReviewLoop["status"], string> = {
  running: "Ready",
  reviewing: "Reviewing",
  passed: "Passed",
  feedback_sent: "Feedback sent",
  error: "Error",
  stopped: "Stopped",
};
const reviewVerdictLabels: Record<ReviewRun["verdict"], string> = {
  pass: "Pass",
  needs_changes: "Needs changes",
  feedback: "Feedback",
  unknown: "Unknown",
};

export function TaskWorkspace({
  task,
  attention,
  agentProfiles,
  reviewLoop,
  reviewRuns,
  onClose,
  onStopSession,
  onResumeSession,
  onStartSession,
  onStartReview,
  onCreatePullRequest,
  onUpdateStatus,
  onDeleteTask,
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
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );
  const startReviewDisabled = !selectedReviewerProfile || reviewerProfiles.length === 0 || reviewInProgress;
  const reviewReadyForNextStep = reviewLoop?.status === "passed";
  const canCreatePullRequest = Boolean(task.activeSessionId && !task.prUrl);
  const createPullRequestDescription = task.prUrl
    ? "Pull request linked"
    : task.activeSessionId
      ? "Ask the running agent to open a pull request"
      : "Start or resume the agent first";
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
      onClick: undefined,
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
    <section className="task-workspace" aria-label="Task workspace">
      <main className="task-terminal-stage">
        <header className="task-terminal-header">
          <div className="task-terminal-heading">
            <Button
              variant="ghost"
              onClick={onClose}
              aria-label="Back to task board"
              className="-ml-3 h-8 gap-2 px-3 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft data-icon="inline-start" />
              Task Board
            </Button>
            <div className="min-w-0">
              <p className="eyebrow">Agent Terminal</p>
              <h2 className="truncate text-2xl font-bold tracking-tight">{task.title}</h2>
            </div>
          </div>
          <TaskStatusBadges task={task} />
        </header>

        <section className="task-terminal-panel" aria-label="Agent terminal">
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
        </section>
      </main>

      <aside className="task-inspector-sidebar" aria-label="Task inspector">
        <div className="task-inspector-header">
          <p className="eyebrow">Task Detail</p>
          <h3 className="truncate text-xl font-bold leading-tight">{task.title}</h3>
          <TaskStatusBadges task={task} />
        </div>

        <div data-testid="task-detail-body" className="task-inspector-scroll">
          {task.activeSessionId && (
            <section className="task-control-strip" aria-label="Task controls">
              <div className="task-session-actions">
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  aria-label="Stop session"
                  className="task-session-button"
                  onClick={() => onStopSession(task.activeSessionId!)}
                >
                  <Square data-icon="inline-start" fill="currentColor" />
                  Stop
                </Button>
              </div>
            </section>
          )}

          <section className="task-inspector-section" aria-label="Task metadata">
            <div className="task-status-control">
              <span className="task-meta-label">Status:</span>
              <Select value={task.status} onValueChange={(val) => onUpdateStatus(task, val as TaskStatus)}>
                <SelectTrigger
                  aria-label="Task status"
                  className="task-status-trigger h-7 w-fit border-none bg-accent/50 text-xs font-medium hover:bg-accent focus:ring-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statusOrder.map((status) => (
                      <SelectItem key={status} value={status} className="text-xs">
                        {statusLabels[status]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="task-meta-row">
              <span className="task-meta-label">Mode:</span>
              <Badge variant="outline">{task.hasWorktree ? "Worktree" : "Task only"}</Badge>
            </div>

            {task.hasWorktree && task.branchName && (
              <div className="task-meta-row">
                <span className="task-meta-label">Branch:</span>
                <span className="task-meta-branch" title={task.branchName}>
                  <GitBranch size={12} />
                  <span>{task.branchName}</span>
                </span>
              </div>
            )}

            {task.hasWorktree && task.worktreePath && (
              <div className="task-meta-row">
                <span className="task-meta-label">Worktree:</span>
                <span className="task-meta-path" title={task.worktreePath}>
                  {task.worktreePath}
                </span>
              </div>
            )}

            <div className="task-meta-row">
              <span className="task-meta-label">PR:</span>
              {task.prUrl ? (
                <a className="task-meta-link" href={task.prUrl} target="_blank" rel="noreferrer">
                  Open <ExternalLink size={12} />
                </a>
              ) : (
                <Badge variant="outline">Not linked</Badge>
              )}
            </div>

            <div className="task-meta-row">
              <span className="task-meta-label">Agent:</span>
              <span className="truncate">{sessionAgentLabel}</span>
            </div>

            <div className="task-meta-row task-delete-row">
              <span className="task-meta-label">Actions:</span>
              <TaskDeleteDialog
                task={task}
                busy={busy}
                isDeleting={isDeleting}
                onDelete={onDeleteTask}
                buttonVariant="destructive"
                buttonSize="sm"
                buttonClassName="task-delete-action"
                showButtonText
              />
            </div>
          </section>

          {attention && (
            <Alert
              className={cn(
                "mt-4 border-primary/25 bg-primary/5 px-3 py-3",
                attention.kind === "needs_input" && "border-amber-500/35 bg-amber-500/10",
              )}
            >
              {attention.kind === "needs_input" ? <AlertTriangle size={16} /> : <CircleCheckBig size={16} />}
              <AlertTitle className="font-bold">
                {attention.kind === "needs_input" ? formatAttentionReason(attention.reason) : "Agent finished"}
              </AlertTitle>
              {attentionDetail && (
                <AlertDescription
                  className="[overflow-wrap:anywhere]"
                  title={isAttentionDetailTruncated ? attentionDetail : undefined}
                >
                  {displayedAttentionDetail}
                </AlertDescription>
              )}
            </Alert>
          )}

          {task.prompt && (
            <section className="task-brief-panel" aria-label="Task brief">
              <span className="task-meta-label">Brief:</span>
              <p className="task-brief">{task.prompt}</p>
            </section>
          )}

          <section className="task-workflow-panel" aria-label="Task workflow">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Task Workflow</p>
              <p className="mt-1 text-xs text-muted-foreground">Review, prepare, and close out the task.</p>
            </div>

            <Stepper
              className="mt-4"
              value={workflowStep}
              orientation="vertical"
              indicators={{
                completed: <Check className="size-3.5" />,
                loading: <LoaderCircle className="size-3.5 animate-spin" />,
              }}
            >
              <StepperNav className="w-full">
                {workflowSteps.map((step, index) => (
                  <StepperItem
                    key={step.title}
                    step={index + 1}
                    completed={step.completed}
                    disabled={step.disabled}
                    loading={step.loading}
                    className="relative items-start not-last:flex-1"
                  >
                    <div className={cn("w-full", index < workflowSteps.length - 1 ? "pb-10" : "pb-0")}>
                      <StepperTrigger
                        className="w-full items-start gap-2.5 text-left disabled:cursor-not-allowed"
                        onClick={step.onClick}
                      >
                        <StepperIndicator className="data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground">
                          {index + 1}
                        </StepperIndicator>
                        <div className="mt-0.5 min-w-0 text-left">
                          <StepperTitle>{step.title}</StepperTitle>
                          <StepperDescription>
                            {selectedReviewerProfile && index === 0 ? (
                              <span className="task-review-step-description">
                                <span aria-hidden="true">
                                  <AgentLogo agentKind={selectedReviewerProfile.agentKind} size="sm" />
                                </span>
                                <span>{step.description}</span>
                              </span>
                            ) : (
                              step.description
                            )}
                          </StepperDescription>
                        </div>
                      </StepperTrigger>

                      {index === 0 && (
                        <div className="task-review-action">
                          <Button
                            type="button"
                            size="xs"
                            aria-label={reviewActionLabel}
                            className="task-review-action-main"
                            disabled={startReviewDisabled}
                            onClick={startReview}
                          >
                            {reviewInProgress && (
                              <LoaderCircle data-icon="inline-start" className="animate-spin" />
                            )}
                            <span>{reviewInProgress ? "Reviewing" : "Review"}</span>
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                aria-label="Change reviewer"
                                className="task-reviewer-menu"
                                disabled={reviewActive || reviewerProfiles.length === 0}
                              >
                                {selectedReviewerProfile ? (
                                  <>
                                    <span aria-hidden="true">
                                      <AgentLogo agentKind={selectedReviewerProfile.agentKind} size="sm" />
                                    </span>
                                    <span className="task-reviewer-menu-label">{selectedReviewerProfile.name}</span>
                                  </>
                                ) : (
                                  <span className="task-reviewer-menu-label">Reviewer</span>
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

                      {index === 1 && !task.prUrl && (
                        <div className="task-review-action">
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            aria-label="Ask agent to create pull request"
                            className="task-review-action-main"
                            disabled={!task.activeSessionId}
                            onClick={() => onCreatePullRequest(task)}
                          >
                            <GitPullRequest data-icon="inline-start" />
                            Create PR
                          </Button>
                        </div>
                      )}
                    </div>
                    {index < workflowSteps.length - 1 && (
                      <StepperSeparator className="absolute inset-y-0 left-3 top-7 -order-1 m-0 -translate-x-1/2 group-data-[orientation=vertical]/stepper-nav:h-[calc(100%-2rem)] group-data-[state=completed]/step:bg-primary" />
                    )}
                  </StepperItem>
                ))}
              </StepperNav>
            </Stepper>
          </section>

          {(reviewLoop || latestReviewRun) && (
            <section className="review-panel" aria-label="Task review">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Review</p>
                  <p className="mt-1 text-xs text-muted-foreground">Latest reviewer status and feedback.</p>
                </div>
                {reviewLoop && (
                  <Badge variant="outline" className="rounded-md">
                    {reviewLoopStatusLabels[reviewLoop.status]}
                  </Badge>
                )}
              </div>

              {latestReviewRun && (
                <div className="review-run-summary">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold">Review feedback</span>
                    <Badge variant="outline" className="rounded-md">
                      {reviewVerdictLabels[latestReviewRun.verdict]}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
                    {latestReviewRun.error ?? latestReviewRun.output}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
      </aside>
    </section>
  );
}

function TaskStatusBadges({ task }: { task: TaskSummary }) {
  return (
    <div className="detail-status-row">
      <Badge variant="outline" data-status={task.status}>
        {statusLabels[task.status]}
      </Badge>
      {task.activeSessionId && (
        <Badge variant="outline" className="border-primary/40 text-primary">
          Running
        </Badge>
      )}
      {task.isDirty && (
        <Badge variant="outline" className="text-indigo-500">
          Dirty worktree
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
