import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import { isTauriRuntime } from "../sessionNotifications";
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

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<ReviewLoopUpdatedEvent>("review_loop_updated", (event) => {
      if (disposed) return;
      onReviewLoopUpdated?.(event.payload.reviewLoop);
      if (selectedTaskIdRef.current !== event.payload.taskId) return;
      setSelectedReviewLoop(event.payload.reviewLoop);
      // A run is starting: clear the live pane before its first chunk arrives.
      if (event.payload.reviewLoop.status === "reviewing") setLiveReviewOutput("");
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

  // Stream the selected task's reviewer stdout into the live buffer. A chunk at
  // offset 0 starts a fresh run, so it replaces the buffer rather than appending.
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<ReviewOutputEvent>("review_output", (event) => {
      if (disposed || selectedTaskIdRef.current !== event.payload.taskId) return;
      setLiveReviewOutput((current) =>
        event.payload.startOffset === 0 ? event.payload.data : current + event.payload.data,
      );
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
  }, [publishMessage]);

  return {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    setSelectedReviewRuns,
    liveReviewOutput,
    message,
  };
}
