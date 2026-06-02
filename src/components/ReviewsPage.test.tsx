import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  reviewOutput: "## Review\nLooks good.",
  lastError: null,
  worktreePath: null,
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:01:00.000Z",
};

function renderPage(overrides: Partial<Parameters<typeof ReviewsPage>[0]> = {}) {
  const props = {
    prReviews: [readyReview],
    selectedPrReview: readyReview,
    selectedPrReviewId: readyReview.id,
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

it("submits a trimmed pull request URL with the default reviewer", () => {
  const onCreateReview = vi.fn();
  renderPage({ prReviews: [], selectedPrReview: undefined, selectedPrReviewId: undefined, onCreateReview });

  fireEvent.change(screen.getByLabelText("Pull request URL"), {
    target: { value: "  https://github.com/owner/repo/pull/9  " },
  });
  fireEvent.click(screen.getByRole("button", { name: /review pull request/i }));

  expect(onCreateReview).toHaveBeenCalledWith("https://github.com/owner/repo/pull/9", 1);
});

it("offers an empty state when there are no reviews", () => {
  renderPage({ prReviews: [], selectedPrReview: undefined, selectedPrReviewId: undefined });

  expect(screen.getByText("No reviews yet")).toBeInTheDocument();
});
