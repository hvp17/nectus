import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import { useTauriEvent } from "./useTauriEvent";
import type { ReviewLoop, ReviewLoopUpdatedEvent, ReviewOutputEvent, ReviewRun } from "../types";

interface UseTaskReviewLoopArgs {
  selectedTaskId?: number;
  onMessage?: (message: string) => void;
  onReviewLoopUpdated?: (reviewLoop: ReviewLoop) => void;
}

export function useTaskReviewLoop({ selectedTaskId, onMessage, onReviewLoopUpdated }: UseTaskReviewLoopArgs) {
  const [selectedReviewLoop, setSelectedReviewLoop] = useState<ReviewLoop | null>(null);
  const [selectedReviewRuns, setSelectedReviewRuns] = useState<ReviewRun[]>([]);
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

  useAsyncEffect(
    async (alive) => {
      if (!selectedTaskId) {
        setSelectedReviewLoop(null);
        setSelectedReviewRuns([]);
        return;
      }
      try {
        const [reviewLoop, reviewRuns] = await Promise.all([
          api.getTaskReviewLoop(selectedTaskId),
          api.listTaskReviewRuns(selectedTaskId),
        ]);
        if (alive()) {
          setSelectedReviewLoop(reviewLoop);
          setSelectedReviewRuns(reviewRuns);
        }
      } catch (error) {
        if (alive()) publishMessage(String(error));
      }
    },
    [publishMessage, selectedTaskId],
  );

  useTauriEvent<ReviewLoopUpdatedEvent>(
    "review_loop_updated",
    (payload) => {
      onReviewLoopUpdated?.(payload.reviewLoop);
      if (selectedTaskIdRef.current !== payload.taskId) return;
      setSelectedReviewLoop(payload.reviewLoop);
      // A run is starting: clear the live pane before its first chunk arrives.
      if (payload.reviewLoop.status === "reviewing") setLiveReviewOutput("");
      if (payload.reviewRun) {
        setSelectedReviewRuns((current) => [...current, payload.reviewRun!]);
      }
    },
    { onError: (error) => publishMessage(String(error)) },
  );

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
