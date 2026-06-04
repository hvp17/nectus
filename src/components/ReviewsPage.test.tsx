import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReviewsPage } from "./ReviewsPage";
import type { AgentProfile, PrReview } from "../types";

const profiles: AgentProfile[] = [
  {
    id: 1,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Claude",
    agentKind: "claude",
    command: "claude",
    model: null,
    args: [],
    env: {},
    createdAt: "2026-06-02T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
  },
];

const readyReview: PrReview = {
  id: 1,
  repoId: 7,
  repoName: "nectus-desktop",
  reviewerProfileId: 2,
  reviewerName: "Claude",
  prUrl: "https://github.com/owner/repo/pull/5",
  prNumber: 5,
  prTitle: "Add caching",
  prAuthor: "octocat",
  baseBranch: "main",
  status: "ready",
  verdict: "passed",
  reviewOutput: "## Review\nLooks good.",
  lastError: null,
  worktreePath: null,
  mode: "single",
  maxRounds: null,
  roundsCompleted: 0,
  converged: null,
  reviewers: [],
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:01:00.000Z",
};

function renderPage(overrides: Partial<Parameters<typeof ReviewsPage>[0]> = {}) {
  const props = {
    prReviews: [readyReview],
    selectedPrReview: readyReview,
    selectedPrReviewId: readyReview.id,
    selectedPrReviewRuns: [],
    agentProfiles: profiles,
    defaultReviewerProfileId: 1,
    creatingReview: false,
    onSelectReview: vi.fn(),
    onCreateReview: vi.fn(),
    onRerunReview: vi.fn(),
    onDeleteReview: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<ReviewsPage {...props} />);
  return props;
}

it("shows the selected review output and copies it to the clipboard", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

  renderPage();

  expect(screen.getByText(/Looks good\./)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /copy review/i }));

  await waitFor(() => expect(writeText).toHaveBeenCalledWith("## Review\nLooks good."));
  expect(await screen.findByText("Copied")).toBeInTheDocument();
});

it("submits a trimmed pull request URL with the default single reviewer", () => {
  const onCreateReview = vi.fn();
  renderPage({ prReviews: [], selectedPrReview: undefined, selectedPrReviewId: undefined, onCreateReview });

  fireEvent.change(screen.getByLabelText("Pull request URL"), {
    target: { value: "  https://github.com/owner/repo/pull/9  " },
  });
  fireEvent.click(screen.getByRole("button", { name: /review pull request/i }));

  // One reviewer selected (the default) → single review, no round cap.
  expect(onCreateReview).toHaveBeenCalledWith("https://github.com/owner/repo/pull/9", [1], undefined);
});

it("runs a consensus review when a second reviewer is selected", () => {
  const onCreateReview = vi.fn();
  renderPage({ prReviews: [], selectedPrReview: undefined, selectedPrReviewId: undefined, onCreateReview });

  fireEvent.change(screen.getByLabelText("Pull request URL"), {
    target: { value: "https://github.com/owner/repo/pull/9" },
  });
  // Add Claude alongside the default Codex → two reviewers → consensus + rounds.
  fireEvent.click(screen.getByRole("button", { name: "Claude" }));
  expect(screen.getByLabelText("Consensus rounds")).toBeInTheDocument();
  // The submit button keeps its constant aria-label even as its text changes.
  expect(screen.getByText("Review with consensus")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /review pull request/i }));

  const [url, reviewerIds, maxRounds] = onCreateReview.mock.calls[0];
  expect(url).toBe("https://github.com/owner/repo/pull/9");
  expect([...reviewerIds].sort()).toEqual([1, 2]);
  expect(maxRounds).toBe(3);
});

it("offers an empty state when there are no reviews", () => {
  renderPage({ prReviews: [], selectedPrReview: undefined, selectedPrReviewId: undefined });

  expect(screen.getByText("No reviews yet")).toBeInTheDocument();
});

it("groups reviews into lifecycle sections with verdict badges", () => {
  const queued: PrReview = {
    ...readyReview,
    id: 2,
    prNumber: 8,
    status: "queued",
    verdict: null,
    reviewOutput: null,
  };
  const blockers: PrReview = { ...readyReview, id: 3, prNumber: 9, status: "ready", verdict: "blockers" };

  renderPage({ prReviews: [blockers, queued, readyReview] });

  // The queued review sits under "To review".
  const toReview = within(screen.getByRole("region", { name: "To review" }));
  expect(toReview.getByText("Queued")).toBeInTheDocument();
  expect(toReview.getByText("#8")).toBeInTheDocument();

  // Finished reviews land in "Done" and surface their verdict, not a bare "Ready".
  const done = within(screen.getByRole("region", { name: "Done" }));
  expect(done.getByText("Blocking issues")).toBeInTheDocument();
  expect(done.getAllByText("Passed").length).toBeGreaterThan(0);
  expect(screen.queryByText("Ready")).not.toBeInTheDocument();
});
