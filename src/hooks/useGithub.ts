import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useGithubStatusQuery, useGithubPullRequestQuery } from "../queries/github";
import { queryKeys } from "../queries/keys";
import { useAsyncEffect } from "./useAsyncEffect";
import { isCliConnected } from "../lib/connection";
import type { MergeMethod, PullRequestInfo, TaskSummary } from "../types";

interface UseGithubInput {
  selectedTask: TaskSummary | undefined;
  setMessage: (message: string | null) => void;
  applyTask: (task: TaskSummary) => void;
}

/**
 * Owns GitHub connection state and the live pull request status for the selected
 * task — now backed by TanStack Query. The connection status and the per-task PR
 * status are queries (`src/queries/github.ts`): keying the PR query on the task id
 * makes Query discard out-of-order responses on a task switch (replacing the old
 * monotonic `requestRef` guard), and the query's `refetchInterval` /
 * `refetchOnWindowFocus` reproduce the 30s open-PR poll and focus refetch, both
 * stopping automatically once the PR is terminal. The PR-action and create flows
 * write the refreshed status straight into the cache.
 */
export function useGithub({ selectedTask, setMessage, applyTask }: UseGithubInput) {
  const queryClient = useQueryClient();

  const githubStatus = useGithubStatusQuery().data;
  const ghReady = isCliConnected(githubStatus);

  const pullRequestQuery = useGithubPullRequestQuery(selectedTask, ghReady);
  const pullRequest = pullRequestQuery.data ?? null;
  const pullRequestLoading = pullRequestQuery.isLoading;

  const [creatingPullRequest, setCreatingPullRequest] = useState(false);
  // Shared busy flag for the merge / mark-ready / close actions, so their buttons
  // disable while a `gh` action is in flight.
  const [pullRequestBusy, setPullRequestBusy] = useState(false);

  const selectedTaskId = selectedTask?.id;
  const selectedPrUrl = selectedTask?.prUrl ?? null;
  const selectedHasWorktree = selectedTask?.hasWorktree ?? false;

  // When a worktree task has no linked PR yet, ask gh whether one already exists for
  // its branch (e.g. opened from the terminal) and backfill it. Backfilling `prUrl`
  // re-enables the PR-status query above, which then loads its checks.
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

  // Run a gh PR action (merge / ready / close) and write the refreshed status it
  // returns straight into the cache, so the panel updates without a round-trip.
  const runPullRequestAction = useCallback(
    async (taskId: number, action: () => Promise<PullRequestInfo>, successMessage: string) => {
      setMessage(null);
      setPullRequestBusy(true);
      try {
        const info = await action();
        queryClient.setQueryData(queryKeys.github.pullRequest(taskId), info);
        setMessage(successMessage);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setPullRequestBusy(false);
      }
    },
    [queryClient, setMessage],
  );

  const mergePullRequest = useCallback(
    (task: TaskSummary, method: MergeMethod) =>
      runPullRequestAction(
        task.id,
        () => api.mergeGithubPullRequest(task.id, method),
        `Merged pull request for ${task.title}`,
      ),
    [runPullRequestAction],
  );

  const setPullRequestReady = useCallback(
    (task: TaskSummary) =>
      runPullRequestAction(
        task.id,
        () => api.setGithubPullRequestReady(task.id, true),
        `Marked pull request ready for ${task.title}`,
      ),
    [runPullRequestAction],
  );

  const closePullRequest = useCallback(
    (task: TaskSummary) =>
      runPullRequestAction(
        task.id,
        () => api.closeGithubPullRequest(task.id),
        `Closed pull request for ${task.title}`,
      ),
    [runPullRequestAction],
  );

  const createPullRequest = useCallback(
    async (task: TaskSummary, options: { draft: boolean }) => {
      setMessage(null);
      setCreatingPullRequest(true);
      try {
        const updated = await api.createGithubPullRequest({
          taskId: task.id,
          title: task.title,
          body: task.prompt ?? "",
          draft: options.draft,
        });
        applyTask(updated);
        setMessage(`Opened pull request for ${updated.title}`);
        if (updated.prUrl) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.github.pullRequest(updated.id) });
        }
      } catch (error) {
        setMessage(String(error));
      } finally {
        setCreatingPullRequest(false);
      }
    },
    [setMessage, applyTask, queryClient],
  );

  return {
    githubStatus,
    ghReady,
    pullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    createPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
  };
}
