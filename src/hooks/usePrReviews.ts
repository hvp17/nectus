import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { useOptionalQuery } from "../queries/optional";
import { upsertNewestById } from "../lib/listState";
import type { PrReview, PrReviewRun } from "../types";

interface UsePrReviewsArgs {
  onMessage: (message: string) => void;
}

const EMPTY_REVIEWS: PrReview[] = [];
const EMPTY_RUNS: PrReviewRun[] = [];

function reviewLabel(review: PrReview): string {
  return review.prTitle ?? `PR #${review.prNumber}`;
}

/**
 * Owns the PR-review list, backed by TanStack Query: the list and the selected
 * review's per-round outputs are queries, create/rerun/delete write through the
 * cache, and the `pr_review_updated` subscription keeps both live and notifies on
 * completion. The event handler reads/writes the cache directly (no `prReviewsRef`).
 */
export function usePrReviews({ onMessage }: UsePrReviewsArgs) {
  const queryClient = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: queryKeys.prReviews.list(),
    queryFn: () => api.listPrReviews(),
    staleTime: 5_000,
    meta: { surfaceErrors: true },
  });
  const prReviews = reviewsQuery.data ?? EMPTY_REVIEWS;

  const [selectedPrReviewId, setSelectedPrReviewId] = useState<number | undefined>();
  const [creatingReview, setCreatingReview] = useState(false);

  // The selected (consensus) review's per-reviewer round outputs. Events keep them
  // live afterward via `setQueryData`; single reviews simply return no runs.
  const runsQuery = useOptionalQuery<PrReviewRun[]>(
    selectedPrReviewId == null
      ? null
      : {
          queryKey: queryKeys.prReviews.runs(selectedPrReviewId),
          queryFn: () => api.listPrReviewRuns(selectedPrReviewId),
          meta: { surfaceErrors: true },
        },
  );

  const setReviews = useCallback(
    (updater: (current: PrReview[]) => PrReview[]) => {
      queryClient.setQueryData<PrReview[]>(queryKeys.prReviews.list(), (current) => updater(current ?? []));
    },
    [queryClient],
  );

  // The `pr_review_updated` subscription that keeps this list live now lives in the
  // single `useEventBridge` (it writes the same prReviews list/runs cache entries).

  const createPrReview = useCallback(
    async (prUrl: string, reviewerProfileIds: number[], maxRounds?: number) => {
      setCreatingReview(true);
      try {
        const review = await api.createPrReview({ prUrl, reviewerProfileIds, maxRounds });
        setReviews((current) => upsertNewestById(current, review));
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
        setReviews((current) => upsertNewestById(current, review));
        // The backend cleared the prior rounds; drop the stale ones so the re-run's
        // rounds stream in fresh.
        queryClient.setQueryData<PrReviewRun[]>(queryKeys.prReviews.runs(reviewId), []);
      } catch (error) {
        onMessage(String(error));
      }
    },
    [onMessage, setReviews, queryClient],
  );

  // Post a finished review back to its pull request as a comment. Returns whether it
  // succeeded so the caller can drive a transient "posting" affordance.
  const postReviewComment = useCallback(
    async (reviewId: number): Promise<boolean> => {
      try {
        await api.postPrReviewComment(reviewId);
        const review = queryClient
          .getQueryData<PrReview[]>(queryKeys.prReviews.list())
          ?.find((item) => item.id === reviewId);
        onMessage(`Posted review to ${review ? reviewLabel(review) : "the pull request"}`);
        return true;
      } catch (error) {
        onMessage(String(error));
        return false;
      }
    },
    [onMessage, queryClient],
  );

  const deletePrReview = useCallback(
    async (reviewId: number) => {
      try {
        await api.deletePrReview(reviewId);
        setReviews((current) => current.filter((item) => item.id !== reviewId));
        setSelectedPrReviewId((current) => (current === reviewId ? undefined : current));
        // Drop the deleted review's cached round outputs.
        queryClient.removeQueries({ queryKey: queryKeys.prReviews.runs(reviewId) });
      } catch (error) {
        onMessage(String(error));
      }
    },
    [onMessage, setReviews, queryClient],
  );

  const selectedPrReview = useMemo(
    () => prReviews.find((review) => review.id === selectedPrReviewId),
    [prReviews, selectedPrReviewId],
  );

  const selectedPrReviewRuns = runsQuery.data ?? EMPTY_RUNS;

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
    postReviewComment,
  };
}
