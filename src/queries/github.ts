import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { TaskSummary } from "../types";
import { queryKeys } from "./keys";

/** Poll cadence for a non-terminal PR's status (checks/review move on their own). */
const AUTO_REFRESH_MS = 30_000;

/** GitHub `gh` connection status — loaded once, rarely changes within a session. */
export function useGithubStatusQuery() {
  return useQuery({
    queryKey: queryKeys.github.status(),
    queryFn: () => api.githubStatus(),
    staleTime: 5 * 60_000,
  });
}

/**
 * Live pull request status for the selected task. Replaces the hand-rolled
 * `useGithub` machinery: keying the query by `taskId` makes TanStack Query discard
 * out-of-order responses on a task switch (so the old `requestRef` monotonic token
 * is gone), `refetchInterval` reproduces the 30s open-PR poll, and
 * `refetchOnWindowFocus` reproduces the focus refetch — both automatically stopping
 * once the PR reaches a terminal (merged/closed) state.
 */
export function useGithubPullRequestQuery(task: TaskSummary | undefined, ghConnected: boolean) {
  const taskId = task?.id;
  const enabled = ghConnected && taskId != null && Boolean(task?.prUrl);
  return useQuery({
    queryKey: taskId != null ? queryKeys.github.pullRequest(taskId) : queryKeys.github.pullRequest(-1),
    queryFn: () => api.githubPullRequestStatus(taskId as number),
    enabled,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      const terminal = state === "merged" || state === "closed";
      return terminal ? false : AUTO_REFRESH_MS;
    },
  });
}
