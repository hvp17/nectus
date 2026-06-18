import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../queries/keys";
import { useTasksQuery } from "../queries/core";
import { useAppStore } from "../store/appStore";
import { notifySessionEvent } from "../sessionNotifications";
import { taskFinishedToast } from "../taskNotification";
import { upsertById, upsertNewestById } from "../lib/listState";
import { applyChatRuntimeUpdate, clearChatRuntimeForTask } from "../lib/chat/applyChatRuntime";
import { useTauriEvent } from "./useTauriEvent";
import type {
  ChatMessageEvent,
  ChatSessionExitedEvent,
  ChatSessionRuntimeEvent,
  ChatTranscript,
  ChatUsageEvent,
  PrReview,
  PrReviewRun,
  PrReviewUpdatedEvent,
  ReviewLoopUpdatedEvent,
  ReviewRun,
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
 * live stream.
 */
export function useEventBridge() {
  const queryClient = useQueryClient();
  const tasksQuery = useTasksQuery();
  const tasksRef = useRef<TaskSummary[]>([]);
  const chatPendingRef = useRef<Map<string, ChatMessageEvent>>(new Map());
  const chatFlushRef = useRef<number | null>(null);

  useEffect(() => {
    tasksRef.current = tasksQuery.data ?? [];
  }, [tasksQuery.data]);

  useEffect(() => {
    return () => {
      if (chatFlushRef.current != null) {
        cancelAnimationFrame(chatFlushRef.current);
      }
    };
  }, []);

  const applyChatEvent = useCallback(
    (payload: ChatMessageEvent) => {
      let messagesAfter: ChatTranscript["messages"] = [];
      queryClient.setQueryData<ChatTranscript>(
        queryKeys.task.chat(payload.taskId, payload.agentProfileId ?? null),
        (current) => {
          const base: ChatTranscript = current ?? { session: null, messages: [] };
          const index = base.messages.findIndex((message) => message.id === payload.message.id);
          const messages =
            index >= 0
              ? base.messages.map((message, i) => (i === index ? payload.message : message))
              : [...base.messages, payload.message];
          messagesAfter = messages;
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
      const store = useAppStore.getState();
      const task = tasksRef.current.find((item) => item.id === payload.taskId);
      const outcome = applyChatRuntimeUpdate(store, payload, task, messagesAfter);
      // A completed turn notifies you it's waiting — but never for the task you're
      // already looking at (you can see it finish in the open workspace).
      if (outcome.finished && task && store.selectedTaskId !== task.id) {
        store.setTaskToast(taskFinishedToast(task));
        void notifySessionEvent(`${task.agentName ?? "Agent"} finished`, task.title);
      }
    },
    [queryClient],
  );

  const setTasks = useCallback(
    (updater: (current: TaskSummary[]) => TaskSummary[]) =>
      queryClient.setQueryData<TaskSummary[]>(queryKeys.tasks(), (current = []) => updater(current)),
    [queryClient],
  );
  const handleSubscriptionError = useCallback((error: unknown) => {
    useAppStore.getState().setMessage(String(error));
  }, []);

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
      const key = `${payload.taskId}:${payload.agentProfileId ?? "null"}:${payload.message.id}`;
      chatPendingRef.current.set(key, payload);
      if (chatFlushRef.current != null) return;
      chatFlushRef.current = requestAnimationFrame(() => {
        chatFlushRef.current = null;
        const batch = [...chatPendingRef.current.values()];
        chatPendingRef.current.clear();
        for (const event of batch) {
          applyChatEvent(event);
        }
      });
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<ChatUsageEvent>(
    "session_chat_usage",
    (payload) => {
      queryClient.setQueryData(queryKeys.task.chatUsage(payload.taskId, payload.agentProfileId ?? null), {
        used: payload.used,
        size: payload.size,
      });
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<ChatSessionRuntimeEvent>(
    "session_chat_runtime",
    (payload) => {
      queryClient.setQueryData<ChatTranscript>(
        queryKeys.task.chat(payload.taskId, payload.agentProfileId ?? null),
        (current) => {
          const base: ChatTranscript = current ?? { session: null, messages: [] };
          const session =
            base.session?.id === payload.sessionId
              ? { ...base.session, runtime: payload.runtime }
              : base.session ?? {
                  id: payload.sessionId,
                  taskId: payload.taskId,
                  agentProfileId: payload.agentProfileId ?? null,
                  acpSessionId: null,
                  cwd: "",
                  runtime: payload.runtime,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                };
          return { ...base, session };
        },
      );
    },
    { onError: handleSubscriptionError },
  );

  useTauriEvent<ChatSessionExitedEvent>(
    "chat_session_exited",
    (payload) => {
      clearChatRuntimeForTask(useAppStore.getState(), payload.taskId);
    },
    { onError: handleSubscriptionError },
  );
}
