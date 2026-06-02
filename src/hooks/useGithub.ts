import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { GithubStatus, PullRequestInfo, TaskSummary } from "../types";

interface UseGithubInput {
  selectedTask: TaskSummary | undefined;
  setMessage: (message: string | null) => void;
  applyTask: (task: TaskSummary) => void;
}

/**
 * Owns GitHub connection state and the live pull request status for the selected
 * task. Connection status is loaded once; PR status is (re)fetched whenever the
 * selected task changes to one that has a linked PR and `gh` is connected.
 */
export function useGithub({ selectedTask, setMessage, applyTask }: UseGithubInput) {
  const [githubStatus, setGithubStatus] = useState<GithubStatus>();
  const [pullRequest, setPullRequest] = useState<PullRequestInfo | null>(null);
  const [pullRequestLoading, setPullRequestLoading] = useState(false);
  const [creatingPullRequest, setCreatingPullRequest] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .githubStatus()
      .then((status) => {
        if (!cancelled) setGithubStatus(status);
      })
      .catch(() => {
        if (!cancelled) setGithubStatus({ installed: false, authenticated: false, account: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ghReady = Boolean(githubStatus?.installed && githubStatus?.authenticated);

  // Monotonic request token so out-of-order responses (from rapid task switches
  // or overlapping refreshes) can never apply stale PR data to the current task.
  const requestRef = useRef(0);

  const loadPullRequest = useCallback(async (taskId: number) => {
    const requestId = (requestRef.current += 1);
    setPullRequestLoading(true);
    try {
      const info = await api.githubPullRequestStatus(taskId);
      if (requestRef.current === requestId) setPullRequest(info);
    } catch {
      // Soft-fail: the panel still shows the stored PR link; status is best-effort.
      if (requestRef.current === requestId) setPullRequest(null);
    } finally {
      if (requestRef.current === requestId) setPullRequestLoading(false);
    }
  }, []);

  const selectedTaskId = selectedTask?.id;
  const selectedPrUrl = selectedTask?.prUrl ?? null;
  const selectedHasWorktree = selectedTask?.hasWorktree ?? false;

  useEffect(() => {
    // Invalidate any in-flight fetch whenever the selected task changes.
    requestRef.current += 1;
    setPullRequest(null);
    if (!ghReady || !selectedTaskId || !selectedPrUrl) return;
    void loadPullRequest(selectedTaskId);
  }, [ghReady, selectedTaskId, selectedPrUrl, loadPullRequest]);

  useEffect(() => {
    // When a worktree task has no linked PR yet, ask gh whether one already
    // exists for its branch (e.g. opened from the terminal) and backfill it.
    // Backfilling `prUrl` re-triggers the status effect above, which loads checks.
    if (!ghReady || !selectedTaskId || !selectedHasWorktree || selectedPrUrl) return;
    let cancelled = false;
    api
      .detectGithubPullRequest(selectedTaskId)
      .then((task) => {
        if (!cancelled && task) applyTask(task);
      })
      .catch(() => {
        // Soft-fail: detection is best-effort; the Create button stays available.
      });
    return () => {
      cancelled = true;
    };
  }, [ghReady, selectedTaskId, selectedHasWorktree, selectedPrUrl, applyTask]);

  const refreshPullRequest = useCallback(
    (task: TaskSummary) => {
      if (!task.prUrl) return;
      void loadPullRequest(task.id);
    },
    [loadPullRequest],
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
        if (updated.prUrl) void loadPullRequest(updated.id);
      } catch (error) {
        setMessage(String(error));
      } finally {
        setCreatingPullRequest(false);
      }
    },
    [setMessage, applyTask, loadPullRequest],
  );

  return {
    githubStatus,
    ghReady,
    pullRequest,
    pullRequestLoading,
    creatingPullRequest,
    refreshPullRequest,
    createPullRequest,
  };
}
