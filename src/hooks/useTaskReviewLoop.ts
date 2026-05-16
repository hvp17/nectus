import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import { isTauriRuntime } from "../sessionNotifications";
import type { ReviewLoop, ReviewLoopUpdatedEvent, ReviewRun } from "../types";

interface UseTaskReviewLoopArgs {
  selectedTaskId?: number;
  onMessage?: (message: string) => void;
  onReviewLoopUpdated?: (reviewLoop: ReviewLoop) => void;
}

export function useTaskReviewLoop({ selectedTaskId, onMessage, onReviewLoopUpdated }: UseTaskReviewLoopArgs) {
  const [selectedReviewLoop, setSelectedReviewLoop] = useState<ReviewLoop | null>(null);
  const [selectedReviewRuns, setSelectedReviewRuns] = useState<ReviewRun[]>([]);
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

  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedReviewLoop(null);
      setSelectedReviewRuns([]);
      return;
    }

    let disposed = false;
    Promise.all([api.getTaskReviewLoop(selectedTaskId), api.listTaskReviewRuns(selectedTaskId)])
      .then(([reviewLoop, reviewRuns]) => {
        if (disposed) return;
        setSelectedReviewLoop(reviewLoop);
        setSelectedReviewRuns(reviewRuns);
      })
      .catch((error) => {
        if (!disposed) publishMessage(String(error));
      });

    return () => {
      disposed = true;
    };
  }, [publishMessage, selectedTaskId]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<ReviewLoopUpdatedEvent>("review_loop_updated", (event) => {
      if (disposed) return;
      onReviewLoopUpdated?.(event.payload.reviewLoop);
      if (selectedTaskIdRef.current !== event.payload.taskId) return;
      setSelectedReviewLoop(event.payload.reviewLoop);
      if (event.payload.reviewRun) {
        setSelectedReviewRuns((current) => [...current, event.payload.reviewRun!]);
      }
    })
      .then((callback) => {
        if (disposed) {
          callback();
        } else {
          unlisten = callback;
        }
      })
      .catch((error) => {
        if (!disposed) publishMessage(String(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onReviewLoopUpdated, publishMessage]);

  return {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    setSelectedReviewRuns,
    message,
  };
}
