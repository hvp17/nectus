import { render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PrReviewDetail } from "./PrReviewDetail";
import type { PrReview, PrReviewRun } from "../types";

const consensusReview: PrReview = {
  id: 11,
  repoId: 7,
  repoName: "nectus-desktop",
  reviewerProfileId: 1,
  reviewerName: "Codex",
  prUrl: "https://github.com/owner/repo/pull/12",
  prNumber: 12,
  prTitle: "Add caching",
  prAuthor: "octocat",
  baseBranch: "main",
  status: "ready",
  verdict: "blockers",
  reviewOutput: "## Consensus\nBlocking: missing test for the cache eviction path.",
  lastError: null,
  worktreePath: null,
  mode: "consensus",
  maxRounds: 3,
  roundsCompleted: 2,
  converged: true,
  reviewers: [
    { reviewerProfileId: 1, reviewerName: "Codex" },
    { reviewerProfileId: 2, reviewerName: "Claude" },
  ],
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:02:00.000Z",
};

const runs: PrReviewRun[] = [
  {
    id: 1,
    prReviewId: 11,
    reviewerProfileId: 1,
    reviewerName: "Codex",
    round: 1,
    verdict: "blockers",
    output: "Codex round 1: missing eviction test.",
    error: null,
    createdAt: "2026-06-02T00:00:30.000Z",
  },
  {
    id: 2,
    prReviewId: 11,
    reviewerProfileId: 2,
    reviewerName: "Claude",
    round: 1,
    verdict: "passed",
    output: "Claude round 1: looks fine.",
    error: null,
    createdAt: "2026-06-02T00:00:31.000Z",
  },
  {
    id: 3,
    prReviewId: 11,
    reviewerProfileId: 1,
    reviewerName: "Codex",
    round: 2,
    verdict: "blockers",
    output: "Codex round 2: holding on the missing test.",
    error: null,
    createdAt: "2026-06-02T00:01:30.000Z",
  },
  {
    id: 4,
    prReviewId: 11,
    reviewerProfileId: 2,
    reviewerName: "Claude",
    round: 2,
    verdict: "blockers",
    output: "Claude round 2: agreed, the eviction test is missing.",
    error: null,
    createdAt: "2026-06-02T00:01:31.000Z",
  },
];

it("renders the consensus summary, synthesized review, and per-round reviewer cards", () => {
  render(<PrReviewDetail review={consensusReview} runs={runs} onRerun={vi.fn()} onDelete={vi.fn()} />);

  // Header shows the consensus mode and convergence summary.
  expect(screen.getByText("2-model consensus")).toBeInTheDocument();
  expect(screen.getByText("Converged in 2 rounds")).toBeInTheDocument();

  // The synthesized consensus review is shown.
  expect(screen.getByText(/missing test for the cache eviction path/)).toBeInTheDocument();

  // Both rounds render, each with both reviewers' outputs.
  expect(screen.getByRole("group", { name: "Round 1" })).toBeInTheDocument();
  const roundTwo = within(screen.getByRole("group", { name: "Round 2" }));
  expect(roundTwo.getByText(/agreed, the eviction test is missing/)).toBeInTheDocument();
});

it("falls back to a verdict-only view for a single review", () => {
  const single: PrReview = {
    ...consensusReview,
    id: 12,
    mode: "single",
    reviewers: [],
    maxRounds: null,
    converged: null,
    verdict: "passed",
    reviewOutput: "## Review\nLooks good.",
  };

  render(<PrReviewDetail review={single} runs={[]} onRerun={vi.fn()} onDelete={vi.fn()} />);

  expect(screen.queryByText("Rounds")).not.toBeInTheDocument();
  expect(screen.getByText(/Looks good\./)).toBeInTheDocument();
});
