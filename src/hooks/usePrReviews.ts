import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import { isTauriRuntime, notifySessionEvent } from "../sessionNotifications";
import type { PrReview, PrReviewRun, PrReviewUpdatedEvent } from "../types";

interface UsePrReviewsArgs {
  onMessage: (message: string) => void;
}

/** Newest-first upsert: replace a matching review in place, else prepend it. */
function upsertNewestFirst(list: PrReview[], review: PrReview): PrReview[] {
  return list.some((item) => item.id === review.id)
    ? list.map((item) => (item.id === review.id ? review : item))
    : [review, ...list];
}

/** Append a round run, replacing it if its id is already present. */
function appendRun(list: PrReviewRun[], run: PrReviewRun): PrReviewRun[] {
  return list.some((item) => item.id === run.id)
    ? list.map((item) => (item.id === run.id ? run : item))
    : [...list, run];
}

function reviewLabel(review: PrReview): string {
  return review.prTitle ?? `PR #${review.prNumber}`;
}

/**
 * Owns the PR-review list: initial load, create/rerun/delete, and the
 * `pr_review_updated` subscription that keeps the list live and notifies when a
 * review finishes. Kept separate from `useApp` so the review concern stays
 * self-contained.
 */
export function usePrReviews({ onMessage }: UsePrReviewsArgs) {
  const [prReviews, setPrReviews] = useState<PrReview[]>([]);
  const [selectedPrReviewId, setSelectedPrReviewId] = useState<number | undefined>();
  const [creatingReview, setCreatingReview] = useState(false);
  const [runsByReview, setRunsByReview] = useState<Record<number, PrReviewRun[]>>({});
  const prReviewsRef = useRef<PrReview[]>([]);

  const setReviews = useCallback((updater: (current: PrReview[]) => PrReview[]) => {
    setPrReviews((current) => {
      const next = updater(current);
      prReviewsRef.current = next;
      return next;
    });
  }, []);

  useAsyncEffect(
    async (alive) => {
      try {
        const reviews = await api.listPrReviews();
        if (alive()) setReviews(() => reviews);
      } catch (error) {
        if (alive()) onMessage(String(error));
      }
    },
    [onMessage, setReviews],
  );

  // Load the per-reviewer round outputs whenever a (consensus) review is opened.
  // Events keep them live afterward; single reviews simply return no runs.
  useAsyncEffect(
    async (alive) => {
      if (selectedPrReviewId === undefined) return;
      const reviewId = selectedPrReviewId;
      try {
        const runs = await api.listPrReviewRuns(reviewId);
        if (alive()) setRunsByReview((current) => ({ ...current, [reviewId]: runs }));
      } catch (error) {
        if (alive()) onMessage(String(error));
      }
    },
    [selectedPrReviewId, onMessage],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<PrReviewUpdatedEvent>("pr_review_updated", (event) => {
      if (disposed) return;
      const review = event.payload.prReview;
      const previousStatus = prReviewsRef.current.find((item) => item.id === review.id)?.status;
      setReviews((current) => upsertNewestFirst(current, review));

      const latestRun = event.payload.latestRun;
      if (latestRun) {
        setRunsByReview((current) => ({
          ...current,
          [latestRun.prReviewId]: appendRun(current[latestRun.prReviewId] ?? [], latestRun),
        }));
      }

      if (review.status === previousStatus) return;
      if (review.status === "ready") {
        onMessage(`PR review ready: ${reviewLabel(review)}`);
        void notifySessionEvent("PR review ready", reviewLabel(review));
      } else if (review.status === "error") {
        const detail = review.lastError ?? "Unknown error";
        onMessage(`PR review failed: ${detail}`);
        void notifySessionEvent("PR review failed", detail);
      }
    })
      .then((callback) => {
        if (disposed) callback();
        else unlisten = callback;
      })
      .catch((error) => {
        if (!disposed) onMessage(String(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onMessage, setReviews]);

  const createPrReview = useCallback(
    async (prUrl: string, reviewerProfileIds: number[], maxRounds?: number) => {
      setCreatingReview(true);
      try {
        const review = await api.createPrReview({ prUrl, reviewerProfileIds, maxRounds });
        setReviews((current) => upsertNewestFirst(current, review));
        setSelectedPrReviewId(review.id);
        onMessage(`PR review queued: ${reviewLabel(review)}`);
        return review;
      } catch (error) {
        onMessage(String(error));
        return null;
      } finally {
        setCreatingReview(false);
      }
    },
    [onMessage, setReviews],
  );

  const rerunPrReview = useCallback(
    async (reviewId: number) => {
      try {
        const review = await api.rerunPrReview(reviewId);
        setReviews((current) => upsertNewestFirst(current, review));
        // The backend cleared the prior rounds; drop the stale ones so the
        // re-run's rounds stream in fresh.
        setRunsByReview((current) => ({ ...current, [reviewId]: [] }));
      } catch (error) {
        onMessage(String(error));
      }
    },
    [onMessage, setReviews],
  );

  const deletePrReview = useCallback(
    async (reviewId: number) => {
      try {
        await api.deletePrReview(reviewId);
        setReviews((current) => current.filter((item) => item.id !== reviewId));
        setSelectedPrReviewId((current) => (current === reviewId ? undefined : current));
      } catch (error) {
        onMessage(String(error));
      }
    },
    [onMessage, setReviews],
  );

  const selectedPrReview = useMemo(
    () => prReviews.find((review) => review.id === selectedPrReviewId),
    [prReviews, selectedPrReviewId],
  );

  const selectedPrReviewRuns = useMemo(
    () => (selectedPrReviewId === undefined ? [] : runsByReview[selectedPrReviewId] ?? []),
    [runsByReview, selectedPrReviewId],
  );

  return {
    prReviews,
    selectedPrReviewId,
    setSelectedPrReviewId,
    selectedPrReview,
    selectedPrReviewRuns,
    creatingReview,
    createPrReview,
    rerunPrReview,
    deletePrReview,
  };
}
