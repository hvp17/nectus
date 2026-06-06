import { fireEvent, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openExternal } from "../lib/openExternal";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { GithubStatus, MergeMethod, PullRequestInfo, TaskSummary } from "../types";
import { GitHubPanel } from "./GitHubPanel";

vi.mock("../lib/openExternal", () => ({ openExternal: vi.fn() }));

const mockedOpenExternal = vi.mocked(openExternal);

beforeEach(() => {
  mockedOpenExternal.mockClear();
});

const baseTask: TaskSummary = {
  id: 42,
  repoId: 7,
  taskRepos: [],
  title: "Add GitHub integration",
  prompt: "Wire up gh.",
  status: "review",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/github",
  worktreePath: "/tmp/wt/feat-github",
  isDirty: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

const connected: GithubStatus = { installed: true, authenticated: true, account: "hvp17" };

function render(input?: {
  task?: TaskSummary;
  githubStatus?: GithubStatus;
  pullRequest?: PullRequestInfo | null;
  pullRequestLoading?: boolean;
  creatingPullRequest?: boolean;
  onCreatePullRequest?: (task: TaskSummary, options: { draft: boolean }) => void;
  onRefreshPullRequest?: (task: TaskSummary) => void;
  onMergePullRequest?: (task: TaskSummary, method: MergeMethod) => void;
  onSetPullRequestReady?: (task: TaskSummary) => void;
  onClosePullRequest?: (task: TaskSummary) => void;
}) {
  return renderWithTooltipProvider(
    <GitHubPanel
      task={input?.task ?? baseTask}
      githubStatus={input?.githubStatus ?? connected}
      pullRequest={input?.pullRequest ?? null}
      pullRequestLoading={input?.pullRequestLoading}
      creatingPullRequest={input?.creatingPullRequest}
      onCreatePullRequest={input?.onCreatePullRequest ?? vi.fn()}
      onRefreshPullRequest={input?.onRefreshPullRequest ?? vi.fn()}
      onMergePullRequest={input?.onMergePullRequest ?? vi.fn()}
      onSetPullRequestReady={input?.onSetPullRequestReady ?? vi.fn()}
      onClosePullRequest={input?.onClosePullRequest ?? vi.fn()}
    />,
  );
}

describe("GitHubPanel", () => {
  it("prompts to install gh when the CLI is missing", () => {
    render({ githubStatus: { installed: false, authenticated: false, account: null } });

    expect(screen.getByText(/github cli/i)).toBeInTheDocument();
    expect(screen.getByText(/install/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create pull request/i })).not.toBeInTheDocument();
  });

  it("prompts to sign in when gh is installed but not authenticated", () => {
    render({ githubStatus: { installed: true, authenticated: false, account: null } });

    expect(screen.getByText(/gh auth login/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create pull request/i })).not.toBeInTheDocument();
  });

  it("creates a pull request for a connected task with a worktree", () => {
    const onCreatePullRequest = vi.fn();

    render({ onCreatePullRequest });

    expect(screen.getByText(/hvp17/i)).toBeInTheDocument();
    screen.getByRole("button", { name: /create pull request/i }).click();

    expect(onCreatePullRequest).toHaveBeenCalledWith(baseTask, { draft: false });
  });

  it("explains that a worktree is required when the task has none", () => {
    const taskWithoutWorktree: TaskSummary = {
      ...baseTask,
      hasWorktree: false,
      branchName: null,
      worktreePath: null,
    };

    render({ task: taskWithoutWorktree });

    expect(screen.getByText(/worktree branch/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create pull request/i })).not.toBeInTheDocument();
  });

  it("shows live pull request status when a PR is linked", () => {
    const onRefreshPullRequest = vi.fn();
    const linkedTask: TaskSummary = { ...baseTask, prUrl: "https://github.com/hvp17/nectus/pull/9" };
    const pullRequest: PullRequestInfo = {
      number: 9,
      url: "https://github.com/hvp17/nectus/pull/9",
      title: "Add GitHub integration",
      state: "open",
      isDraft: false,
      reviewDecision: "review_required",
      checks: { total: 3, passed: 1, failed: 1, pending: 1 },
      checksState: "failing",
      checkRuns: [],
    };

    render({ task: linkedTask, pullRequest, onRefreshPullRequest });

    expect(screen.getByText(/#9/)).toBeInTheDocument();
    expect(screen.getByText("Open", { selector: "[data-pr-state]" })).toBeInTheDocument();
    expect(screen.getByText(/review required/i)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: '[data-check="failed"]' })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open pull request/i })).toHaveAttribute(
      "href",
      "https://github.com/hvp17/nectus/pull/9",
    );

    screen.getByRole("button", { name: /refresh pull request/i }).click();
    expect(onRefreshPullRequest).toHaveBeenCalledWith(linkedTask);
  });

  it("opens the pull request in the default browser when Open is clicked", () => {
    const prUrl = "https://github.com/hvp17/nectus/pull/9";
    const linkedTask: TaskSummary = { ...baseTask, prUrl };

    render({ task: linkedTask });

    screen.getByRole("link", { name: /open pull request/i }).click();

    expect(mockedOpenExternal).toHaveBeenCalledWith(prUrl);
  });

  const prUrl = "https://github.com/hvp17/nectus/pull/9";
  const linkedTask: TaskSummary = { ...baseTask, prUrl };
  const openPr: PullRequestInfo = {
    number: 9,
    url: prUrl,
    title: "Add GitHub integration",
    state: "open",
    isDraft: false,
    reviewDecision: "approved",
    checks: { total: 2, passed: 1, failed: 1, pending: 0 },
    checksState: "failing",
    checkRuns: [
      { name: "build", workflow: "CI", state: "pass", url: "https://github.com/hvp17/nectus/actions/runs/1" },
      { name: "lint", workflow: "Quality", state: "fail", url: "https://github.com/hvp17/nectus/actions/runs/2" },
    ],
  };

  it("marks a draft pull request ready for review", () => {
    const onSetPullRequestReady = vi.fn();
    const draftPr: PullRequestInfo = { ...openPr, isDraft: true, checkRuns: [] };

    render({ task: linkedTask, pullRequest: draftPr, onSetPullRequestReady });

    screen.getByRole("button", { name: /mark pull request ready/i }).click();

    expect(onSetPullRequestReady).toHaveBeenCalledWith(linkedTask);
  });

  it("merges an open pull request after confirming, with the chosen method", async () => {
    const onMergePullRequest = vi.fn();

    render({ task: linkedTask, pullRequest: openPr, onMergePullRequest });

    fireEvent.click(screen.getByRole("button", { name: /merge pull request/i }));
    const dialog = await screen.findByRole("alertdialog");
    // Default is squash; switch to rebase before confirming.
    fireEvent.click(within(dialog).getByText("Rebase"));
    fireEvent.click(within(dialog).getByRole("button", { name: /^merge$/i }));

    expect(onMergePullRequest).toHaveBeenCalledWith(linkedTask, "rebase");
  });

  it("closes an open pull request after confirming", async () => {
    const onClosePullRequest = vi.fn();

    render({ task: linkedTask, pullRequest: openPr, onClosePullRequest });

    fireEvent.click(screen.getByRole("button", { name: /close pull request/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /close pr/i }));

    expect(onClosePullRequest).toHaveBeenCalledWith(linkedTask);
  });

  it("hides the ship actions when gh is not connected", () => {
    render({
      task: linkedTask,
      pullRequest: openPr,
      githubStatus: { installed: true, authenticated: false, account: null },
    });

    expect(screen.queryByRole("button", { name: /merge pull request/i })).not.toBeInTheDocument();
    // The linked PR card (and its Open link) still render without gh.
    expect(screen.getByRole("link", { name: /open pull request/i })).toBeInTheDocument();
  });

  it("expands the checks drill-down to show each GitHub Actions run and its link", () => {
    render({ task: linkedTask, pullRequest: openPr });

    fireEvent.click(screen.getByRole("button", { name: /show check details/i }));

    expect(screen.getByText("build")).toBeInTheDocument();
    expect(screen.getByText("lint")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open build check/i })).toHaveAttribute(
      "href",
      "https://github.com/hvp17/nectus/actions/runs/1",
    );
  });
});
