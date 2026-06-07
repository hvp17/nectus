import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useGithubStatusQuery, useGithubPullRequestQuery } from "../queries/github";
import { queryKeys } from "../queries/keys";
import { useAsyncEffect } from "./useAsyncEffect";
import { isCliConnected } from "../lib/connection";
import type { TaskSummary } from "../types";

interface UseGithubInput {
  selectedTask: TaskSummary | undefined;
  applyTask: (task: TaskSummary) => void;
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
export function useGithub({ selectedTask, applyTask }: UseGithubInput) {
  const queryClient = useQueryClient();

  const githubStatus = useGithubStatusQuery().data;
  const ghReady = isCliConnected(githubStatus);

  const pullRequestQuery = useGithubPullRequestQuery(selectedTask, ghReady);
  const pullRequest = pullRequestQuery.data ?? null;
  const pullRequestLoading = pullRequestQuery.isLoading;

  const selectedTaskId = selectedTask?.id;
  const selectedPrUrl = selectedTask?.prUrl ?? null;
  const selectedHasWorktree = selectedTask?.hasWorktree ?? false;

  // When a worktree task has no linked PR yet, ask gh whether one already exists for
  // its branch (e.g. opened from the terminal by the agent) and backfill it.
  // Backfilling `prUrl` re-enables the PR-status query above, which then loads its
  // checks.
  useAsyncEffect(
    async (alive) => {
      if (!ghReady || !selectedTaskId || !selectedHasWorktree || selectedPrUrl) return;
      try {
        const task = await api.detectGithubPullRequest(selectedTaskId);
        if (alive() && task) applyTask(task);
      } catch {
        // Soft-fail: detection is best-effort; the Create button stays available.
      }
    },
    [ghReady, selectedTaskId, selectedHasWorktree, selectedPrUrl, applyTask],
  );

  const refreshPullRequest = useCallback(
    (task: TaskSummary) => {
      if (!task.prUrl) return;
      void queryClient.invalidateQueries({ queryKey: queryKeys.github.pullRequest(task.id) });
    },
    [queryClient],
  );

  return {
    githubStatus,
    ghReady,
    pullRequest,
    pullRequestLoading,
    refreshPullRequest,
  };
}
