import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import { useTasksQuery } from "../queries/core";
import { useAppStore } from "../store/appStore";
import { notifySessionEvent } from "../sessionNotifications";
import { clearTaskAttention, upsertTaskAttention } from "../sessionAttention";
import {
  sessionIdleContent,
  sessionNeedsInputContent,
  taskToastFromContent,
} from "../taskNotification";
import { upsertById, upsertNewestById } from "../lib/listState";
import { useTauriEvent } from "./useTauriEvent";
import type {
  ChatMessageEvent,
  ChatTranscript,
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

  const setTasks = useCallback(
    (updater: (current: TaskSummary[]) => TaskSummary[]) =>
      queryClient.setQueryData<TaskSummary[]>(queryKeys.tasks(), (current = []) => updater(current)),
    [queryClient],
  );
  const handleSubscriptionError = useCallback((error: unknown) => {
    useAppStore.getState().setMessage(String(error));
  }, []);

  useTauriEvent<SessionIdleEvent>(
    "session_idle",
    (payload) => {
      const store = useAppStore.getState();
      const task = tasksRef.current.find((item) => item.id === payload.taskId);
      const content = sessionIdleContent(task, payload);
      if (task) {
        store.setTaskAttention((current) => upsertTaskAttention(current, task, payload));
        store.setTaskToast(taskToastFromContent(task, content, "success"));
      } else {
        store.setMessage(`${content.title}: ${content.body}`);
      }
      void notifySessionEvent(content.title, content.body);
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<SessionNeedsInputEvent>(
    "session_needs_input",
    (payload) => {
      const store = useAppStore.getState();
      const task = tasksRef.current.find((item) => item.id === payload.taskId);
      const content = sessionNeedsInputContent(task, payload);
      if (task) {
        store.setTaskAttention((current) => upsertTaskAttention(current, task, payload));
        store.setTaskToast(taskToastFromContent(task, content, "info"));
      } else {
        store.setMessage(`${content.title} for ${content.body}`);
      }
      void notifySessionEvent(content.title, content.body);
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<SessionActivityEvent>(
    "session_activity",
    (payload) => {
      const store = useAppStore.getState();
      // Skip the write (and the re-render fan-out) when the line is unchanged —
      // in-place spinner/status redraws repeat the same line at a high rate.
      if (store.liveLines[payload.taskId] === payload.line) return;
      store.setLiveLines((current) => ({ ...current, [payload.taskId]: payload.line }));
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<SessionExitedEvent>(
    "session_exited",
    (payload) => {
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
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<ReviewLoopUpdatedEvent>(
    "review_loop_updated",
    (payload) => {
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
        queryClient.setQueryData<ReviewRun[]>(queryKeys.task.reviewRuns(taskId), (current = []) =>
          upsertById(current, reviewRun),
        );
      }
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<PrReviewUpdatedEvent>(
    "pr_review_updated",
    (payload) => {
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
    },
    { onError: handleSubscriptionError },
  );

  // ACP chat: each event is the full current message snapshot (upsert by id);
  // `done` marks it settled. Routed into the task's chat transcript cache so
  // `useTaskChat` reflects the live stream without a separate store slice.
  useTauriEvent<ChatMessageEvent>(
    "session_chat",
    (payload) => {
      queryClient.setQueryData<ChatTranscript>(
        queryKeys.task.chat(payload.taskId, payload.agentProfileId ?? null),
        (current) => {
          const base: ChatTranscript = current ?? { session: null, messages: [] };
          const index = base.messages.findIndex((message) => message.id === payload.message.id);
          const messages =
            index >= 0
              ? base.messages.map((message, i) => (i === index ? payload.message : message))
              : [...base.messages, payload.message];
          const session =
            base.session?.id === payload.sessionId
              ? base.session
              : base.session ?? {
                  id: payload.sessionId,
                  taskId: payload.taskId,
                  agentProfileId: payload.agentProfileId ?? null,
                  acpSessionId: null,
                  cwd: "",
                  createdAt: payload.message.createdAt,
                  updatedAt: payload.message.createdAt,
                };
          return { session, messages };
        },
      );
    },
    { onError: handleSubscriptionError },
  );
}
