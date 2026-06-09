import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import { useTasksQuery } from "../queries/core";
import { useAppStore } from "../store/appStore";
import { isTauriRuntime } from "../lib/tauriRuntime";
import { notifySessionEvent } from "../sessionNotifications";
import { clearTaskAttention, upsertTaskAttention } from "../sessionAttention";
import {
  sessionIdleContent,
  sessionNeedsInputContent,
  taskFinishedToast,
  taskNeedsInputToast,
} from "../taskNotification";
import { upsertById, upsertNewestById } from "../lib/listState";
import type {
  PrReview,
  PrReviewRun,
  PrReviewUpdatedEvent,
  ReviewLoopUpdatedEvent,
  ReviewRun,
  SessionActivityEvent,
  SessionExitedEvent,
  SessionIdleEvent,
  SessionNeedsInputEvent,
  TaskSummary,
} from "../types";

function prReviewLabel(review: PrReview): string {
  return review.prTitle ?? `PR #${review.prNumber}`;
}

/**
 * The single, mount-once Tauri event bridge. It owns every session/review/PR
 * subscription and routes each event to its durable sink (the TanStack Query cache)
 * or its ephemeral sink (the Zustand store), so the domain hooks can be pure cache
 * consumers callable from any component without double-subscribing.
 *
 * Mount it exactly once, at the app root (`AppLayout`). Reads live state at event
 * time via `queryClient`, `useAppStore.getState()`, and a `tasksRef` synced from the
 * tasks cache — never via stale closures. Cache writes use default-param updaters
 * (`(cur = []) => …`) and `setQueryData` directly (not `makeCacheSetter`, which
 * skips empty-cache updaters) so an event arriving before the first fetch still
 * lands and is reconciled by the fetch.
 *
 * `review_output` is NOT here — it stays in `useTaskReviewLoop` as a per-component
 * live stream. `session_idle` for the diff stays in `useTaskDiff` (mounted once).
 */
export function useEventBridge() {
  const queryClient = useQueryClient();
  const tasksQuery = useTasksQuery();
  const tasksRef = useRef<TaskSummary[]>([]);

  useEffect(() => {
    tasksRef.current = tasksQuery.data ?? [];
  }, [tasksQuery.data]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    const add = async <T,>(eventName: string, handler: (payload: T) => void) => {
      const unlisten = await listen<T>(eventName, (event) => {
        if (!disposed) handler(event.payload);
      });
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };

    const setTasks = (updater: (current: TaskSummary[]) => TaskSummary[]) =>
      queryClient.setQueryData<TaskSummary[]>(queryKeys.tasks(), (current = []) => updater(current));

    const register = async () => {
      await add<SessionIdleEvent>("session_idle", (payload) => {
        const store = useAppStore.getState();
        const task = tasksRef.current.find((item) => item.id === payload.taskId);
        const { title, body } = sessionIdleContent(task, payload);
        if (task) {
          store.setTaskAttention((current) => upsertTaskAttention(current, task, payload));
          store.setTaskToast(taskFinishedToast(task, payload));
        } else {
          store.setMessage(`${title}: ${body}`);
        }
        void notifySessionEvent(title, body);
      });

      await add<SessionNeedsInputEvent>("session_needs_input", (payload) => {
        const store = useAppStore.getState();
        const task = tasksRef.current.find((item) => item.id === payload.taskId);
        const { title, body } = sessionNeedsInputContent(task, payload);
        if (task) {
          store.setTaskAttention((current) => upsertTaskAttention(current, task, payload));
          store.setTaskToast(taskNeedsInputToast(task, payload));
        } else {
          store.setMessage(`${title} for ${body}`);
        }
        void notifySessionEvent(title, body);
      });

      await add<SessionActivityEvent>("session_activity", (payload) => {
        useAppStore.getState().setLiveLines((current) => ({ ...current, [payload.taskId]: payload.line }));
      });

      await add<SessionExitedEvent>("session_exited", (payload) => {
        const exited = tasksRef.current.find((task) => task.activeSessionId === payload.sessionId);
        setTasks((current) =>
          current.map((task) =>
            task.activeSessionId === payload.sessionId ? { ...task, activeSessionId: null } : task,
          ),
        );
        if (exited) {
          const store = useAppStore.getState();
          store.setLiveLines((current) => {
            if (!(exited.id in current)) return current;
            const next = { ...current };
            delete next[exited.id];
            return next;
          });
          store.setTaskAttention((current) => clearTaskAttention(current, exited.id));
        }
      });

      await add<ReviewLoopUpdatedEvent>("review_loop_updated", (payload) => {
        const { taskId, reviewLoop, reviewRun } = payload;
        // Reflect the loop's status onto the task (the old `applyReviewLoopToTask`):
        // a passed loop marks the task done.
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId
              ? {
                  ...task,
                  status: reviewLoop.status === "passed" ? "done" : task.status,
                  reviewLoopStatus: reviewLoop.status,
                }
              : task,
          ),
        );
        queryClient.setQueryData(queryKeys.task.reviewLoop(taskId), reviewLoop);
        if (reviewRun) {
          queryClient.setQueryData(queryKeys.task.reviewRuns(taskId), (current: ReviewRun[] = []) => [
            ...current,
            reviewRun,
          ]);
        }
      });

      await add<PrReviewUpdatedEvent>("pr_review_updated", (payload) => {
        const review = payload.prReview;
        const previousStatus = queryClient
          .getQueryData<PrReview[]>(queryKeys.prReviews.list())
          ?.find((item) => item.id === review.id)?.status;
        queryClient.setQueryData<PrReview[]>(queryKeys.prReviews.list(), (current = []) =>
          upsertNewestById(current, review),
        );
        if (payload.latestRun) {
          const latestRun = payload.latestRun;
          queryClient.setQueryData<PrReviewRun[]>(queryKeys.prReviews.runs(latestRun.prReviewId), (current = []) =>
            upsertById(current, latestRun),
          );
        }
        if (review.status === previousStatus) return;
        if (review.status === "ready") {
          useAppStore.getState().setMessage(`PR review ready: ${prReviewLabel(review)}`);
          void notifySessionEvent("PR review ready", prReviewLabel(review));
        } else if (review.status === "error") {
          const errorDetail = review.lastError ?? "Unknown error";
          useAppStore.getState().setMessage(`PR review failed: ${errorDetail}`);
          void notifySessionEvent("PR review failed", errorDetail);
        }
      });
    };

    register().catch((error) => {
      if (!disposed) useAppStore.getState().setMessage(String(error));
    });

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [queryClient]);
}
