import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Check, ChevronDown, GitPullRequest, LoaderCircle, MessagesSquare } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { TaskRepoScopePicker } from "./taskWorkspace/TaskRepoScopePicker";
import { TaskWorkspaceFactsRail } from "./taskWorkspace/TaskWorkspaceFactsRail";
import { TaskWorkspaceStage, type WorkflowStep } from "./taskWorkspace/TaskWorkspaceStage";
import { deriveAttentionPreview } from "./attentionPreview";
import { isReviewLoopActive } from "../statusLabels";
import { isCliConnected } from "../lib/connection";
import { isCrossRepoTask } from "../lib/taskRepos";
import { resolveReviewerProfileId } from "../lib/agentProfiles";
import { isAcpCapableAgent } from "../lib/acpAgent";
import { useAcpProvidersQuery } from "../queries/core";
import { useAppStore } from "../store/appStore";
import { useTaskDiff } from "../hooks/useTaskDiff";
import { type TaskAttention } from "../sessionAttention";
import {
  AgentProfile,
  GithubStatus,
  MergeMethod,
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
  pullRequestBusy?: boolean;
  /** Label for the back affordance, e.g. "Mission Control" or the project name. */
  backLabel?: string;
  /** Project/repo name shown in the identity line. */
  repoName?: string;
  /** Cross-repo scope: the member repo the Diff tab + GitHub panel target. */
  activeRepoId?: number;
  onSelectRepo?: (repoId: number | undefined) => void;
  onClose: () => void;
  /** Persist the task's reviewer choice (`start_pair_loop`); reviews run via `/review`. */
  onConfigureReviewer: (task: TaskSummary, reviewerProfileId: number) => void;
  onCreatePullRequest: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onRefreshPullRequest: (task: TaskSummary) => void;
  onMergePullRequest: (task: TaskSummary, method: MergeMethod) => void;
  onSetPullRequestReady: (task: TaskSummary) => void;
  onClosePullRequest: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  onRenameTask: (task: TaskSummary, title: string) => void;
  /** Archive the task (leaves the boards; worktree kept until deletion). */
  onArchiveTask: (task: TaskSummary) => void;
  onDeleteTask: (task: TaskSummary) => void;
  onSetJiraLink: (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) => void;
  /** Connected JIRA site host, used to build the linked story's browse URL. */
  jiraSite?: string | null;
  busy?: boolean;
  isDeleting?: boolean;
}

/**
 * Which workflow step is current: 1 = work with the agent, 2 = review passed
 * (ready to ship), 3 = done. A finished task or an opened PR is the final step;
 * an in-progress review keeps the user on step 1; a passed review advances to 2.
 */
function currentWorkflowStep(args: {
  isDone: boolean;
  hasPullRequest: boolean;
  reviewInProgress: boolean;
  reviewPassed: boolean;
}): number {
  if (args.isDone || args.hasPullRequest) return 3;
  if (args.reviewInProgress) return 1;
  if (args.reviewPassed) return 2;
  return 1;
}

/** The hint shown under the "Create pull request" action, naming the current path. */
function pullRequestActionHint(args: {
  hasPullRequest: boolean;
  canCreateViaGithub: boolean;
  hasAcpAgent: boolean;
  githubReady: boolean;
}): string {
  if (args.hasPullRequest) return "Pull request linked";
  if (args.canCreateViaGithub) return "Open a pull request with the GitHub CLI";
  if (args.hasAcpAgent) return "Ask the chat agent to open a pull request";
  if (args.githubReady) return "Add a worktree branch to open a pull request";
  return "Choose an ACP-capable agent or connect the GitHub CLI";
}

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
  pullRequestBusy = false,
  backLabel = "Task board",
  repoName,
  activeRepoId,
  onSelectRepo,
  onClose,
  onConfigureReviewer,
  onCreatePullRequest,
  onRefreshPullRequest,
  onMergePullRequest,
  onSetPullRequestReady,
  onClosePullRequest,
  onUpdateStatus,
  onRenameTask,
  onArchiveTask,
  onDeleteTask,
  onSetJiraLink,
  jiraSite,
  busy = false,
  isDeleting = false,
}: TaskWorkspaceProps) {
  const defaultReviewerProfileId = resolveReviewerProfileId(agentProfiles, task?.agentProfileId);
  const [reviewerProfileId, setReviewerProfileId] = useState<number | undefined>(
    reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId,
  );

  useEffect(() => {
    setReviewerProfileId(reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId);
  }, [defaultReviewerProfileId, reviewLoop?.reviewerProfileId]);

  const diff = useTaskDiff(task?.id, activeRepoId);
  const { refresh: refreshDiff } = diff;
  const acpProviders = useAcpProvidersQuery().data ?? [];
  const chatWorkingTaskIds = useAppStore((s) => s.chatWorkingTaskIds);
  const [stageTab, setStageTab] = useState<"diff" | "chat">("chat");
  const [diffSelectedFile, setDiffSelectedFile] = useState<string | null>(null);
  const refreshDiffForOpenTab = useEffectEvent(() => {
    void refreshDiff();
  });

  // Reload the diff when the user opens the Diff tab. Task-switch reloads are
  // owned by useTaskDiff itself, so only the tab switch is reactive here.
  useEffect(() => {
    if (stageTab === "diff") refreshDiffForOpenTab();
  }, [stageTab]);

  const chatWorking = task ? Boolean(chatWorkingTaskIds[task.id]) : false;
  const openedTaskIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!task) return;
    const previousTaskId = openedTaskIdRef.current;
    if (previousTaskId === task.id) return;
    openedTaskIdRef.current = task.id;
    if (previousTaskId !== null) {
      setStageTab("chat");
    }
  }, [task?.id]);

  if (!task) return null;

  // One scope for both per-repo surfaces (Diff tab + GitHub panel). Built only
  // for cross-repo tasks so consumers can fall back (e.g. the GitHub panel shows
  // its auth badge when there is no picker).
  const repoScopePicker =
    onSelectRepo && isCrossRepoTask(task) ? (
      <TaskRepoScopePicker task={task} activeRepoId={activeRepoId} onSelectRepo={onSelectRepo} />
    ) : undefined;

  const latestReviewRun = reviewRuns.at(-1);
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
  const selectedReviewerProfile = agentProfiles.find((profile) => profile.id === reviewerProfileId);
  const reviewActive = Boolean(reviewLoop && isReviewLoopActive(reviewLoop.status));
  // Inline `/review` reviews never set the loop to "reviewing" (that was the old
  // pane runner), so this stays false on the inline path; the workflow ribbon's
  // "Reviewing…" affordance is kept only for the task-status concept.
  const reviewInProgress = reviewLoop?.status === "reviewing";
  const agentLabel = task.agentName ?? "None";
  const {
    detail: attentionDetail,
    displayed: displayedAttentionDetail,
    truncated: isAttentionDetailTruncated,
  } = deriveAttentionPreview(attention);
  const reviewReadyForNextStep = reviewLoop?.status === "passed";
  const githubReady = isCliConnected(githubStatus);
  const canCreateViaGithub = Boolean(githubReady && task.hasWorktree && !task.prUrl);
  const canShipViaAgent = Boolean(isAcpCapableAgent(task.agentKind ?? "custom", acpProviders) || chatWorking);
  const canCreatePullRequest = Boolean(!task.prUrl && (canCreateViaGithub || canShipViaAgent));
  const createPullRequestDescription = pullRequestActionHint({
    hasPullRequest: Boolean(task.prUrl),
    canCreateViaGithub,
    hasAcpAgent: canShipViaAgent,
    githubReady,
  });
  const workflowStep = currentWorkflowStep({
    isDone: task.status === "done",
    hasPullRequest: Boolean(task.prUrl),
    reviewInProgress,
    reviewPassed: reviewReadyForNextStep,
  });
  // Persist the reviewer choice the moment it changes (config only). The review
  // itself runs inline via `/review` in chat, not from this ribbon.
  const configureReviewer = (profileId: number) => {
    setReviewerProfileId(profileId);
    onConfigureReviewer(task, profileId);
  };
  const openChatFile = (path: string) => {
    setDiffSelectedFile(path);
  };
  // Each step carries the inline action shown when it is the CURRENT step. The
  // Review step now only configures the reviewer (the run moved to `/review` in
  // chat); a short hint points the user there.
  const reviewAction = (
    <>
      <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
        <MessagesSquare className="size-3" aria-hidden="true" />
        Run <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">/review</code> in chat
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Change reviewer"
            className="h-8 max-w-[150px]"
            disabled={reviewActive || agentProfiles.length === 0}
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
            {agentProfiles.map((profile) => (
              <DropdownMenuItem
                key={profile.id}
                onSelect={() => configureReviewer(profile.id)}
                className="justify-between"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
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
          ? `${selectedReviewerProfile.name} reviews via /review in chat`
          : "Choose a reviewer profile",
      completed: reviewReadyForNextStep || task.status === "done",
      loading: reviewInProgress,
      disabled: agentProfiles.length === 0 || reviewInProgress,
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
    <section
      data-task-workspace=""
      className="grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)_320px] overflow-hidden bg-background max-[1040px]:grid-cols-[minmax(0,1fr)] max-[1040px]:grid-rows-[minmax(0,auto)_minmax(0,1fr)] max-[1040px]:[&>aside]:-order-1 max-[1040px]:[&>aside]:max-h-[min(42vh,360px)] max-[1040px]:[&>aside]:border-t-0 max-[1040px]:[&>aside]:border-b max-[1040px]:[&>aside]:border-l-0 max-[1040px]:[&>main]:order-1 max-[1040px]:[&>main]:min-h-0"
      aria-label="Task workspace"
    >
      <TaskWorkspaceStage
        task={task}
        backLabel={backLabel}
        onClose={onClose}
        workflowStep={workflowStep}
        workflowSteps={workflowSteps}
        onRenameTask={onRenameTask}
        stageTab={stageTab}
        onStageTabChange={setStageTab}
        repoScopePicker={repoScopePicker}
        diffSelectedFile={diffSelectedFile}
        diff={diff}
        diffFileCount={diffFileCount}
        diffTotals={diffTotals}
        attention={attention}
        displayedAttentionDetail={displayedAttentionDetail}
        attentionDetail={attentionDetail}
        isAttentionDetailTruncated={isAttentionDetailTruncated}
        canCreatePullRequest={canCreatePullRequest}
        onCreatePullRequest={onCreatePullRequest}
        onOpenChatFile={openChatFile}
      />

      <TaskWorkspaceFactsRail
        task={task}
        repoName={repoName}
        activeRepoId={activeRepoId}
        repoScopePicker={repoScopePicker}
        agentLabel={agentLabel}
        githubStatus={githubStatus}
        pullRequest={pullRequest}
        pullRequestLoading={pullRequestLoading}
        creatingPullRequest={creatingPullRequest}
        pullRequestBusy={pullRequestBusy}
        reviewLoop={reviewLoop}
        latestReviewRun={latestReviewRun}
        jiraSite={jiraSite}
        busy={busy}
        isDeleting={isDeleting}
        onUpdateStatus={onUpdateStatus}
        onCreatePullRequest={onCreatePullRequest}
        onRefreshPullRequest={onRefreshPullRequest}
        onMergePullRequest={onMergePullRequest}
        onSetPullRequestReady={onSetPullRequestReady}
        onClosePullRequest={onClosePullRequest}
        onSetJiraLink={onSetJiraLink}
        onArchiveTask={onArchiveTask}
        onDeleteTask={onDeleteTask}
      />
    </section>
  );
}
