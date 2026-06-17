import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { useOptionalQuery } from "../queries/optional";
import type { ReviewLoop, ReviewRun } from "../types";

interface UseTaskReviewLoopArgs {
  selectedTaskId?: number;
  onMessage?: (message: string) => void;
}

const EMPTY_RUNS: ReviewRun[] = [];

/**
 * Owns the selected task's review loop config + run history, backed by TanStack
 * Query (keyed per task). `setSelectedReviewLoop` writes the current task's cache
 * entry so the reviewer-config action (`startPairLoop`) reflects optimistically.
 * The `review_loop_updated` subscription (in `useEventBridge`) keeps the cache +
 * the task-board summary live; reviews themselves now run inline via `/review` in
 * chat (the `Subagent` block in `ChatPane`), not a read-only pane.
 */
export function useTaskReviewLoop({ selectedTaskId, onMessage }: UseTaskReviewLoopArgs) {
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<string | null>(null);
  const selectedTaskIdRef = useRef<number | undefined>(selectedTaskId);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
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

  return {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    message,
  };
}
