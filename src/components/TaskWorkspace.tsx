import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, GitPullRequest, LoaderCircle } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TaskWorkspaceFactsRail } from "./taskWorkspace/TaskWorkspaceFactsRail";
import { TaskWorkspaceStage, type WorkflowStep } from "./taskWorkspace/TaskWorkspaceStage";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { useTaskDiff } from "../hooks/useTaskDiff";
import { type TaskAttention } from "../sessionAttention";
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
  const workflowSteps: WorkflowStep[] = [
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
      <TaskWorkspaceStage
        task={task}
        backLabel={backLabel}
        onClose={onClose}
        workflowStep={workflowStep}
        workflowSteps={workflowSteps}
        stageTab={stageTab}
        onStageTabChange={setStageTab}
        diff={diff}
        diffFileCount={diffFileCount}
        diffTotals={diffTotals}
        reviewOutput={reviewOutput}
        reviewInProgress={reviewInProgress}
        attention={attention}
        displayedAttentionDetail={displayedAttentionDetail}
        attentionDetail={attentionDetail}
        isAttentionDetailTruncated={isAttentionDetailTruncated}
        canCreatePullRequest={canCreatePullRequest}
        onCreatePullRequest={onCreatePullRequest}
        onSessionExit={onSessionExit}
        onSessionInput={onSessionInput}
        canResumeSession={canResumeSession}
        onResumeSession={onResumeSession}
        onStartSession={onStartSession}
      />

      <TaskWorkspaceFactsRail
        task={task}
        repoName={repoName}
        sessionId={sessionId}
        sessionAgentLabel={sessionAgentLabel}
        githubStatus={githubStatus}
        pullRequest={pullRequest}
        pullRequestLoading={pullRequestLoading}
        creatingPullRequest={creatingPullRequest}
        reviewLoop={reviewLoop}
        latestReviewRun={latestReviewRun}
        reviewInProgress={reviewInProgress}
        reviewOutput={reviewOutput}
        jiraSite={jiraSite}
        busy={busy}
        isDeleting={isDeleting}
        onStopSession={onStopSession}
        onUpdateStatus={onUpdateStatus}
        onCreatePullRequest={onCreatePullRequest}
        onRefreshPullRequest={onRefreshPullRequest}
        onSetJiraLink={onSetJiraLink}
        onDeleteTask={onDeleteTask}
        onWatchReview={() => setStageTab("review")}
      />
    </section>
  );
}
