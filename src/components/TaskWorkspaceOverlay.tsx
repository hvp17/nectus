import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { taskRepoName, taskRepoWorktreePath } from "../lib/taskRepos";
import { useAgentProfilesQuery } from "../queries/core";
import { useJiraRestStatusQuery } from "../queries/jira";
import { useAppStore } from "../store/appStore";
import { useGithub } from "../hooks/useGithub";
import { useTaskReviewLoop } from "../hooks/useTaskReviewLoop";
import { useTaskActions } from "../hooks/useTaskActions";
import { useTaskDeletion } from "../hooks/useTaskDeletion";
import { useGithubShipActions } from "../hooks/useGithubShipActions";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { isReviewLoopActive } from "../statusLabels";
import { getTaskAttention } from "../sessionAttention";
import { TaskWorkspace } from "./TaskWorkspace";
import type { AgentProfile, TaskSummary } from "../types";

const EMPTY_PROFILES: AgentProfile[] = [];

interface TaskWorkspaceOverlayProps {
  task: TaskSummary;
  backLabel: string;
  repoName?: string;
  onClose: () => void;
}

/**
 * Self-sufficient wrapper for the open task's workspace: it assembles every
 * `TaskWorkspace` prop from per-task hooks (GitHub PR, review loop, task chat
 * actions) so `TaskWorkspace` itself stays a pure presentational component. This is
 * what lets the shell drop the open-task surface from `useApp`.
 */
export function TaskWorkspaceOverlay({ task, backLabel, repoName, onClose }: TaskWorkspaceOverlayProps) {
  const queryClient = useQueryClient();
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const jiraSite = useJiraRestStatusQuery().data?.site ?? null;
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

  // Scope a cross-repo task's Diff tab + GitHub panel to one member repo
  // (undefined → primary). Reset when another task opens.
  const [activeRepoId, setActiveRepoId] = useState<number | undefined>(undefined);
  useEffect(() => setActiveRepoId(undefined), [task.id]);
  // Ship prompts must run inside the scoped repo's sibling worktree, not the
  // the primary worktree, when a non-primary repo is selected.
  const repoScope = useMemo(() => {
    if (activeRepoId == null || activeRepoId === task.repoId) return null;
    const repoName = taskRepoName(task, activeRepoId);
    const worktreePath = taskRepoWorktreePath(task, activeRepoId);
    return repoName && worktreePath ? { repoName, worktreePath } : null;
  }, [task, activeRepoId]);

  const github = useGithub({ selectedTask: task, applyTask, repoId: activeRepoId });
  const ship = useGithubShipActions({ setMessage, setTaskAttention, repoScope });
  const review = useTaskReviewLoop({ selectedTaskId: task.id, onMessage: setMessage });
  const { updateStatus, renameTask, setTaskJiraLink, setArchived } = useTaskActions();
  const requestDeleteTask = useTaskDeletion();

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
      creatingPullRequest={ship.creatingPullRequest}
      pullRequestBusy={ship.pullRequestBusy}
      backLabel={backLabel}
      repoName={repoName}
      activeRepoId={activeRepoId}
      onSelectRepo={setActiveRepoId}
      onClose={onClose}
      onStartReview={startReview}
      onCreatePullRequest={ship.createPullRequest}
      onRefreshPullRequest={github.refreshPullRequest}
      onMergePullRequest={ship.mergePullRequest}
      onSetPullRequestReady={ship.setPullRequestReady}
      onClosePullRequest={ship.closePullRequest}
      onUpdateStatus={updateStatus}
      onRenameTask={renameTask}
      onArchiveTask={(t) => {
        // Archiving removes the task from the live cache, which closes this
        // overlay (the shell resolves the open task from that cache).
        void setArchived(t, true);
      }}
      onDeleteTask={requestDeleteTask}
      onSetJiraLink={setTaskJiraLink}
      jiraSite={jiraSite}
      busy={busy}
      isDeleting={isDeleting}
    />
  );
}
