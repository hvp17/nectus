import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { taskRepoPrUrl } from "../lib/taskRepos";
import type { PullRequestInfo, TaskSummary } from "../types";
import { queryKeys } from "./keys";
import { useOptionalQuery } from "./optional";

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
export function useGithubPullRequestQuery(
  task: TaskSummary | undefined,
  ghConnected: boolean,
  repoId?: number,
) {
  const taskId = task?.id;
  const enabled = ghConnected && taskId != null && Boolean(taskRepoPrUrl(task, repoId));
  const query = useOptionalQuery<PullRequestInfo>(
    !enabled || taskId == null
      ? null
      : {
          queryKey: queryKeys.github.pullRequest(taskId, repoId),
          queryFn: () => api.githubPullRequestStatus(taskId, repoId),
          refetchOnWindowFocus: true,
          refetchInterval: (query: { state: { data?: PullRequestInfo } }) => {
            const state = query.state.data?.state;
            const terminal = state === "merged" || state === "closed";
            return terminal ? false : AUTO_REFRESH_MS;
          },
        },
  );
  return { data: query.data, isLoading: query.isLoading };
}

/**
 * Best-effort PR auto-detection for a worktree task whose agent may have opened a
 * branch PR from the terminal. Kept as a query so all GitHub command reads share
 * Query's task-keyed stale response handling instead of each hook owning an async
 * effect guard. `repoId` scopes a cross-repo task to one member repo: the
 * backend backfills the primary repo's PR onto `tasks.pr_url` and a non-primary
 * member's onto its `task_repos.pr_url`.
 */
export function useGithubPullRequestDetectionQuery(
  task: TaskSummary | undefined,
  ghConnected: boolean,
  repoId?: number,
) {
  const taskId = task?.id;
  const enabled =
    ghConnected && taskId != null && Boolean(task?.hasWorktree) && !taskRepoPrUrl(task, repoId);
  const query = useOptionalQuery<TaskSummary | null>(
    !enabled || taskId == null
      ? null
      : {
          queryKey: queryKeys.github.pullRequestDetection(taskId, repoId),
          queryFn: () => api.detectGithubPullRequest(taskId, repoId),
          refetchOnWindowFocus: false,
          retry: false,
        },
  );
  return { data: query.data };
}
