import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PrReviewDetail } from "./PrReviewDetail";
import type { AgentProfile, PrReview, PrReviewRun } from "../types";

const agentProfiles: AgentProfile[] = [
  { id: 1, name: "Codex", agentKind: "codex", command: "codex", model: null, args: [], env: {}, createdAt: "", updatedAt: "" },
  { id: 2, name: "Claude", agentKind: "claude", command: "claude", model: null, args: [], env: {}, createdAt: "", updatedAt: "" },
];

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

it("renders the consensus banner, reviewers × rounds matrix, and synthesized review", () => {
  render(
    <PrReviewDetail
      review={consensusReview}
      runs={runs}
      agentProfiles={agentProfiles}
      onRerun={vi.fn()}
      onDelete={vi.fn()}
      onPost={vi.fn()}
    />,
  );

  // Header shows the consensus mode; the banner shows the convergence summary.
  expect(screen.getByText("2-model consensus")).toBeInTheDocument();
  expect(screen.getByText(/Converged in 2 rounds/)).toBeInTheDocument();

  // The synthesized consensus review is shown.
  expect(screen.getByText(/missing test for the cache eviction path/)).toBeInTheDocument();

  // The matrix renders a column per round, the synthesizer tag, and per-cell verdicts.
  expect(screen.getByText("Round 1")).toBeInTheDocument();
  expect(screen.getByText("Round 2")).toBeInTheDocument();
  expect(screen.getByText(/synthesizer/)).toBeInTheDocument();
  expect(screen.getByText("Passed")).toBeInTheDocument(); // Claude, round 1
  expect(screen.getAllByText("Blocking").length).toBeGreaterThanOrEqual(3);
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

  render(
    <PrReviewDetail
      review={single}
      runs={[]}
      agentProfiles={agentProfiles}
      onRerun={vi.fn()}
      onDelete={vi.fn()}
      onPost={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: /post review to pull request/i })).toBeEnabled();
  expect(screen.queryByText(/round 1/i)).not.toBeInTheDocument();
  expect(screen.getByText(/Looks good\./)).toBeInTheDocument();
});

it("posts a finished review back to the pull request", () => {
  const onPost = vi.fn().mockResolvedValue(undefined);

  render(
    <PrReviewDetail
      review={consensusReview}
      runs={runs}
      agentProfiles={agentProfiles}
      onRerun={vi.fn()}
      onDelete={vi.fn()}
      onPost={onPost}
    />,
  );

  screen.getByRole("button", { name: /post review to pull request/i }).click();

  expect(onPost).toHaveBeenCalledWith(consensusReview.id);
});

it("disables sharing while a review is still in progress", () => {
  const queued: PrReview = { ...consensusReview, status: "reviewing", reviewOutput: null };

  render(
    <PrReviewDetail
      review={queued}
      runs={[]}
      agentProfiles={agentProfiles}
      onRerun={vi.fn()}
      onDelete={vi.fn()}
      onPost={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: /post review to pull request/i })).toBeDisabled();
});
