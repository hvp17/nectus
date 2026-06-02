import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import { isTauriRuntime, notifySessionEvent } from "../sessionNotifications";
import type { PrReview, PrReviewUpdatedEvent } from "../types";

interface UsePrReviewsArgs {
  onMessage: (message: string) => void;
}

/** Newest-first upsert: replace a matching review in place, else prepend it. */
function upsertNewestFirst(list: PrReview[], review: PrReview): PrReview[] {
  return list.some((item) => item.id === review.id)
    ? list.map((item) => (item.id === review.id ? review : item))
    : [review, ...list];
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

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<PrReviewUpdatedEvent>("pr_review_updated", (event) => {
      if (disposed) return;
      const review = event.payload.prReview;
      const previousStatus = prReviewsRef.current.find((item) => item.id === review.id)?.status;
      setReviews((current) => upsertNewestFirst(current, review));

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
    async (prUrl: string, reviewerProfileId?: number | null) => {
      setCreatingReview(true);
      try {
        const review = await api.createPrReview({ prUrl, reviewerProfileId });
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

  return {
    prReviews,
    selectedPrReviewId,
    setSelectedPrReviewId,
    selectedPrReview,
    creatingReview,
    createPrReview,
    rerunPrReview,
    deletePrReview,
  };
}
