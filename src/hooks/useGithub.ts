import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGithubStatusQuery,
  useGithubPullRequestQuery,
  useGithubPullRequestDetectionQuery,
} from "../queries/github";
import { queryKeys } from "../queries/keys";
import { isCliConnected } from "../lib/connection";
import { taskRepoPrUrl } from "../lib/taskRepos";
import type { TaskSummary } from "../types";

interface UseGithubInput {
  selectedTask: TaskSummary | undefined;
  applyTask: (task: TaskSummary) => void;
  /** Scope a cross-repo task to one member repo (undefined → the primary repo). */
  repoId?: number;
}

/**
 * Owns GitHub connection state and the live pull request status for the selected
 * task — the **read** side, backed by TanStack Query. The connection status and
 * the per-task PR status are queries (`src/queries/github.ts`): keying the PR
 * query on the task id makes Query discard out-of-order responses on a task
 * switch, and the query's `refetchInterval` / `refetchOnWindowFocus` reproduce the
 * 30s open-PR poll and focus refetch, both stopping once the PR is terminal.
 *
 * The PR **write** actions (create / merge / mark-ready / close) no longer live
 * here: they are agent-driven now and owned by `useGithubShipActions`, which
 * submits a prompt into the task's running session instead of calling `gh`.
 */
export function useGithub({ selectedTask, applyTask, repoId }: UseGithubInput) {
  const queryClient = useQueryClient();

  const githubStatus = useGithubStatusQuery().data;
  const ghReady = isCliConnected(githubStatus);
  const selectedPrUrl = taskRepoPrUrl(selectedTask, repoId);
  const canReadPullRequest = ghReady && selectedTask?.id != null && Boolean(selectedPrUrl);
  const canDetectPullRequest =
    ghReady && selectedTask?.id != null && Boolean(selectedTask?.hasWorktree) && !selectedPrUrl;

  const pullRequestQuery = useGithubPullRequestQuery(selectedTask, ghReady, repoId);
  const pullRequest = canReadPullRequest ? (pullRequestQuery.data ?? null) : null;
  const pullRequestLoading = canReadPullRequest && pullRequestQuery.isLoading;

  // When a worktree task has no linked PR yet, ask gh whether one already exists for
  // its branch (e.g. opened from the terminal by the agent) and backfill it.
  // Backfilling the PR URL re-enables the PR-status query above, which then loads
  // its checks.
  const detectionQuery = useGithubPullRequestDetectionQuery(selectedTask, ghReady, repoId);
  const detectedTask = canDetectPullRequest ? detectionQuery.data : undefined;
  useEffect(() => {
    if (detectedTask) applyTask(detectedTask);
  }, [detectedTask, applyTask]);

  const refreshPullRequest = useCallback(
    (task: TaskSummary) => {
      if (!taskRepoPrUrl(task, repoId)) return;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.github.pullRequest(task.id, repoId),
      });
    },
    [queryClient, repoId],
  );

  return {
    githubStatus,
    ghReady,
    pullRequest,
    pullRequestLoading,
    refreshPullRequest,
  };
}
