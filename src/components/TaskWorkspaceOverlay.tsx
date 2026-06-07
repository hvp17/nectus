import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { useAgentProfilesQuery } from "../queries/core";
import { useJiraStatusQuery } from "../queries/jira";
import { useAppStore } from "../store/appStore";
import { useGithub } from "../hooks/useGithub";
import { useTaskReviewLoop } from "../hooks/useTaskReviewLoop";
import { useTaskActions } from "../hooks/useTaskActions";
import { useTaskDeletion } from "../hooks/useTaskDeletion";
import { useSessionControls } from "../hooks/useSessionControls";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { isReviewLoopActive } from "../statusLabels";
import { clearTaskAttention, getTaskAttention } from "../sessionAttention";
import { TaskWorkspace } from "./TaskWorkspace";
import type { AgentProfile, TaskSummary } from "../types";

const EMPTY_PROFILES: AgentProfile[] = [];

const CREATE_PULL_REQUEST_PROMPT = `Create a pull request for this task. Use the current project/worktree branch. Before opening the PR, verify the work as appropriate for this repo, commit relevant changes with a Conventional Commit if needed, push the branch, create the PR against the remote default branch, and report the PR URL here.`;

interface TaskWorkspaceOverlayProps {
  task: TaskSummary;
  backLabel: string;
  repoName?: string;
  onClose: () => void;
}

/**
 * Self-sufficient wrapper for the open task's workspace: it assembles every
 * `TaskWorkspace` prop from per-task hooks (GitHub PR, review loop, task/session
 * actions) so `TaskWorkspace` itself stays a pure presentational component. This is
 * what lets the shell drop the open-task surface from `useApp`.
 */
export function TaskWorkspaceOverlay({ task, backLabel, repoName, onClose }: TaskWorkspaceOverlayProps) {
  const queryClient = useQueryClient();
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const jiraSite = useJiraStatusQuery().data?.site ?? null;
  const taskAttention = useAppStore((s) => s.taskAttention);
  const busy = useAppStore((s) => s.busy);
  const setBusy = useAppStore((s) => s.setBusy);
  const isDeleting = useAppStore((s) => s.deletingTaskIds.has(task.id));
  const setMessage = useAppStore((s) => s.setMessage);
  const setTaskAttention = useAppStore((s) => s.setTaskAttention);
  const run = useGuardedAction(setMessage, setBusy);

  const setTasks = useMemo(
    () => makeCacheSetter<TaskSummary[]>(queryClient, queryKeys.tasks()),
    [queryClient],
  );
  const applyTask = useCallback(
    (updated: TaskSummary) => setTasks((current) => current.map((t) => (t.id === updated.id ? updated : t))),
    [setTasks],
  );

  const github = useGithub({ selectedTask: task, setMessage, applyTask });
  const review = useTaskReviewLoop({ selectedTaskId: task.id, onMessage: setMessage });
  const { updateStatus, renameTask, setTaskJiraLink } = useTaskActions();
  const requestDeleteTask = useTaskDeletion();
  const session = useSessionControls();

  // Open the PR: a deterministic gh-driven PR for a connected worktree task,
  // otherwise ask the running agent to open one from the terminal.
  const createPullRequest = useCallback(
    async (t: TaskSummary, options?: { draft?: boolean }) => {
      if (t.hasWorktree && github.ghReady) {
        await github.createPullRequest(t, { draft: options?.draft ?? false });
        return;
      }
      if (!t.activeSessionId) {
        setMessage("Start or resume the agent to open a PR, or connect the GitHub CLI for a worktree task.");
        return;
      }
      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, t.id));
      try {
        await api.submitSessionInput(t.activeSessionId, CREATE_PULL_REQUEST_PROMPT);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [github, setMessage, setTaskAttention],
  );

  // Start (or resume) the review loop, then kick off an immediate review.
  const startReview = useCallback(
    (t: TaskSummary, reviewerProfileId: number) =>
      run(async () => {
        let loop = review.selectedReviewLoop;
        if (!loop || !isReviewLoopActive(loop.status)) {
          loop = await api.startPairLoop(t.id, reviewerProfileId);
        }
        const runningLoop = await api.runPairReview(t.id);
        const reviewRuns = await api.listTaskReviewRuns(t.id);
        const nextLoop = runningLoop ?? loop;
        review.setSelectedReviewLoop(
          nextLoop.status === "running" ? { ...nextLoop, status: "reviewing" } : nextLoop,
        );
        review.setSelectedReviewRuns(reviewRuns);
        setMessage("Review: Started");
      }),
    [review, run, setMessage],
  );

  return (
    <TaskWorkspace
      key={task.id}
      task={task}
      attention={getTaskAttention(taskAttention, task.id)}
      agentProfiles={agentProfiles}
      reviewLoop={review.selectedReviewLoop}
      reviewRuns={review.selectedReviewRuns}
      liveReviewOutput={review.liveReviewOutput}
      githubStatus={github.githubStatus}
      pullRequest={github.pullRequest}
      pullRequestLoading={github.pullRequestLoading}
      creatingPullRequest={github.creatingPullRequest}
      pullRequestBusy={github.pullRequestBusy}
      backLabel={backLabel}
      repoName={repoName}
      onClose={onClose}
      onStopSession={session.stopSession}
      onResumeSession={session.resumeSession}
      onStartSession={session.startSession}
      onStartReview={startReview}
      onCreatePullRequest={createPullRequest}
      onRefreshPullRequest={github.refreshPullRequest}
      onMergePullRequest={github.mergePullRequest}
      onSetPullRequestReady={github.setPullRequestReady}
      onClosePullRequest={github.closePullRequest}
      onUpdateStatus={updateStatus}
      onRenameTask={renameTask}
      onDeleteTask={requestDeleteTask}
      onSetJiraLink={setTaskJiraLink}
      jiraSite={jiraSite}
      onSessionExit={session.onSessionExit}
      onSessionInput={session.onSessionInput}
      busy={busy}
      isDeleting={isDeleting}
    />
  );
}
