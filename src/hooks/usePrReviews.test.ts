import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { usePrReviews } from "./usePrReviews";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { api } from "../api";
import type { PrReview } from "../types";

/** A renderHook wrapper with its own fresh QueryClient (isolated cache per test). */
function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

vi.mock("../api", () => ({
  api: {
    listPrReviews: vi.fn().mockResolvedValue([]),
    listPrReviewRuns: vi.fn().mockResolvedValue([]),
    createPrReview: vi.fn(),
    rerunPrReview: vi.fn(),
    deletePrReview: vi.fn(),
  },
}));

const review: PrReview = {
  id: 9,
  repoId: 7,
  repoName: "nectus-desktop",
  reviewerProfileId: 2,
  reviewerName: "Claude",
  prUrl: "https://github.com/owner/repo/pull/9",
  prNumber: 9,
  prTitle: "Add caching",
  prAuthor: "octocat",
  baseBranch: "main",
  status: "queued",
  reviewOutput: null,
  lastError: null,
  worktreePath: null,
  mode: "single",
  maxRounds: null,
  roundsCompleted: 0,
  converged: null,
  reviewers: [],
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listPrReviews).mockResolvedValue([]);
});

it("does not allocate a placeholder runs query before a review is selected", async () => {
  const client = createQueryClient();
  renderHook(() => usePrReviews({ onMessage: vi.fn() }), { wrapper: makeWrapper(client) });
  await waitFor(() => expect(api.listPrReviews).toHaveBeenCalled());

  expect(client.getQueryCache().find({ queryKey: ["pr-reviews", "none", "runs"] })).toBeUndefined();
  expect(client.getQueryCache().find({ queryKey: queryKeys.prReviews.runs(undefined) })).toBeDefined();
  expect(api.listPrReviewRuns).not.toHaveBeenCalled();
});

it("queues a created review at the top of the list and selects it", async () => {
  vi.mocked(api.createPrReview).mockResolvedValue(review);
  const onMessage = vi.fn();

  const { result } = renderHook(() => usePrReviews({ onMessage }), { wrapper: makeWrapper() });
  await waitFor(() => expect(api.listPrReviews).toHaveBeenCalled());

  await act(async () => {
    await result.current.createPrReview("https://github.com/owner/repo/pull/9", [2]);
  });

  expect(result.current.prReviews[0].id).toBe(9);
  expect(result.current.selectedPrReviewId).toBe(9);
  expect(onMessage).toHaveBeenCalledWith(expect.stringContaining("queued"));
});

it("removes a deleted review and clears the selection", async () => {
  vi.mocked(api.listPrReviews).mockResolvedValue([review]);
  vi.mocked(api.deletePrReview).mockResolvedValue(undefined);

  const onMessage = vi.fn();
  const { result } = renderHook(() => usePrReviews({ onMessage }), { wrapper: makeWrapper() });
  await waitFor(() => expect(result.current.prReviews).toHaveLength(1));

  act(() => result.current.setSelectedPrReviewId(review.id));
  await act(async () => {
    await result.current.deletePrReview(review.id);
  });

  expect(result.current.prReviews).toHaveLength(0);
  expect(result.current.selectedPrReviewId).toBeUndefined();
});
