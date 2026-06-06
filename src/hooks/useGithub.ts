import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import { isCliConnected } from "../lib/connection";
import type { GithubStatus, MergeMethod, PullRequestInfo, TaskSummary } from "../types";

interface UseGithubInput {
  selectedTask: TaskSummary | undefined;
  setMessage: (message: string | null) => void;
  applyTask: (task: TaskSummary) => void;
}

/** Poll cadence for a non-terminal PR's status (checks/review move on their own). */
const AUTO_REFRESH_MS = 30_000;

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
  // Shared busy flag for the merge / mark-ready / close actions, so their buttons
  // disable while a `gh` action is in flight.
  const [pullRequestBusy, setPullRequestBusy] = useState(false);

  useAsyncEffect(async (alive) => {
    try {
      const status = await api.githubStatus();
      if (alive()) setGithubStatus(status);
    } catch {
      if (alive()) setGithubStatus({ installed: false, authenticated: false, account: null });
    }
  }, []);

  const ghReady = isCliConnected(githubStatus);

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

  useAsyncEffect(
    async (alive) => {
      // When a worktree task has no linked PR yet, ask gh whether one already
      // exists for its branch (e.g. opened from the terminal) and backfill it.
      // Backfilling `prUrl` re-triggers the status effect above, which loads checks.
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

  // Auto-refresh an open PR so long-running GitHub Actions move to green without a
  // manual click: poll on a light interval and whenever the window regains focus.
  // Only runs while gh is connected and the loaded PR is non-terminal, so a merged/
  // closed PR (and tests / browser preview, where gh is not connected) stay quiet.
  const prTerminal = pullRequest?.state === "merged" || pullRequest?.state === "closed";
  const autoRefresh = ghReady && !!selectedTaskId && !!selectedPrUrl && !!pullRequest && !prTerminal;
  useEffect(() => {
    if (!autoRefresh || !selectedTaskId) return;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadPullRequest(selectedTaskId);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(refresh, AUTO_REFRESH_MS);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [autoRefresh, selectedTaskId, loadPullRequest]);

  const refreshPullRequest = useCallback(
    (task: TaskSummary) => {
      if (!task.prUrl) return;
      void loadPullRequest(task.id);
    },
    [loadPullRequest],
  );

  // Run a gh PR action (merge / ready / close), apply the refreshed status it
  // returns, and surface success/failure as a message. The monotonic token guards
  // against a task switch mid-action overwriting the now-selected task's PR.
  const runPullRequestAction = useCallback(
    async (action: () => Promise<PullRequestInfo>, successMessage: string) => {
      setMessage(null);
      setPullRequestBusy(true);
      const requestId = (requestRef.current += 1);
      try {
        const info = await action();
        if (requestRef.current === requestId) {
          setPullRequest(info);
          setMessage(successMessage);
        }
      } catch (error) {
        setMessage(String(error));
      } finally {
        setPullRequestBusy(false);
      }
    },
    [setMessage],
  );

  const mergePullRequest = useCallback(
    (task: TaskSummary, method: MergeMethod) =>
      runPullRequestAction(
        () => api.mergeGithubPullRequest(task.id, method),
        `Merged pull request for ${task.title}`,
      ),
    [runPullRequestAction],
  );

  const setPullRequestReady = useCallback(
    (task: TaskSummary) =>
      runPullRequestAction(
        () => api.setGithubPullRequestReady(task.id, true),
        `Marked pull request ready for ${task.title}`,
      ),
    [runPullRequestAction],
  );

  const closePullRequest = useCallback(
    (task: TaskSummary) =>
      runPullRequestAction(
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
    pullRequestBusy,
    refreshPullRequest,
    createPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
  };
}
