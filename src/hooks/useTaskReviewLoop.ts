import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { useOptionalQuery } from "../queries/optional";
import { useTauriEvent } from "./useTauriEvent";
import type { ReviewLoop, ReviewOutputEvent, ReviewRun } from "../types";

interface UseTaskReviewLoopArgs {
  selectedTaskId?: number;
  onMessage?: (message: string) => void;
}

const EMPTY_RUNS: ReviewRun[] = [];

/**
 * Owns the selected task's review loop + runs, backed by TanStack Query (keyed per
 * task). The `setSelectedReviewLoop`/`setSelectedReviewRuns` setters write the
 * current task's cache entry, so `useApp`'s `startReview`/`startPairLoop`/
 * `stopPairLoop` keep working unchanged. The `review_loop_updated` subscription
 * keeps the cache + the task-board summary live; `review_output` streams the
 * reviewer's stdout into the ephemeral `liveReviewOutput` buffer (never cached).
 */
export function useTaskReviewLoop({ selectedTaskId, onMessage }: UseTaskReviewLoopArgs) {
  const queryClient = useQueryClient();

  // Accumulated live stdout of the selected task's reviewer, for the read-only
  // Review pane. Reset between runs and when the selected task changes.
  const [liveReviewOutput, setLiveReviewOutput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const selectedTaskIdRef = useRef<number | undefined>(selectedTaskId);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  // A different task has no live stream yet; drop the previous task's output.
  useEffect(() => {
    setLiveReviewOutput("");
  }, [selectedTaskId]);

  const publishMessage = useCallback(
    (nextMessage: string) => {
      setMessage(nextMessage);
      onMessage?.(nextMessage);
    },
    [onMessage],
  );

  const loopQuery = useOptionalQuery<ReviewLoop | null>(
    selectedTaskId === undefined
      ? null
      : {
          queryKey: queryKeys.task.reviewLoop(selectedTaskId),
          queryFn: () => api.getTaskReviewLoop(selectedTaskId),
          staleTime: 0,
        },
  );
  const runsQuery = useOptionalQuery<ReviewRun[]>(
    selectedTaskId === undefined
      ? null
      : {
          queryKey: queryKeys.task.reviewRuns(selectedTaskId),
          queryFn: () => api.listTaskReviewRuns(selectedTaskId),
          staleTime: 0,
        },
  );

  // Surface a load failure via `onMessage`, matching the old try/catch.
  useEffect(() => {
    const error = loopQuery.error ?? runsQuery.error;
    if (error) publishMessage(String(error));
  }, [loopQuery.error, runsQuery.error, publishMessage]);

  const selectedReviewLoop = loopQuery.data ?? null;
  const selectedReviewRuns = runsQuery.data ?? EMPTY_RUNS;

  const setSelectedReviewLoop = useCallback(
    (loop: ReviewLoop | null) => {
      const taskId = selectedTaskIdRef.current;
      if (taskId === undefined) return;
      queryClient.setQueryData(queryKeys.task.reviewLoop(taskId), loop);
    },
    [queryClient],
  );
  const setSelectedReviewRuns = useCallback(
    (runs: ReviewRun[]) => {
      const taskId = selectedTaskIdRef.current;
      if (taskId === undefined) return;
      queryClient.setQueryData(queryKeys.task.reviewRuns(taskId), runs);
    },
    [queryClient],
  );

  // A run is starting (the bridge wrote the loop's status into the cache): clear the
  // live pane before its first chunk arrives. Keyed on the status, so it fires once
  // per entry into "reviewing".
  useEffect(() => {
    if (selectedReviewLoop?.status === "reviewing") setLiveReviewOutput("");
  }, [selectedReviewLoop?.status]);

  // Stream the selected task's reviewer stdout into the live buffer. A chunk at
  // offset 0 starts a fresh run, so it replaces the buffer rather than appending.
  useTauriEvent<ReviewOutputEvent>(
    "review_output",
    (payload) => {
      if (selectedTaskIdRef.current !== payload.taskId) return;
      setLiveReviewOutput((current) =>
        payload.startOffset === 0 ? payload.data : current + payload.data,
      );
    },
    { onError: (error) => publishMessage(String(error)) },
  );

  return {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    setSelectedReviewRuns,
    liveReviewOutput,
    message,
  };
}
