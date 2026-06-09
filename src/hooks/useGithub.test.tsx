import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { createQueryClient } from "../queries/queryClient";
import type { GithubStatus, PullRequestInfo, TaskSummary } from "../types";
import { useGithub } from "./useGithub";

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

vi.mock("../api", () => ({
  api: {
    detectGithubPullRequest: vi.fn(),
    githubPullRequestStatus: vi.fn(),
    githubStatus: vi.fn(),
  },
}));

const connectedStatus: GithubStatus = {
  installed: true,
  authenticated: true,
  account: "hvp17",
};

const linkedPullRequest: PullRequestInfo = {
  number: 123,
  url: "https://github.com/hvp17/nectus/pull/123",
  title: "Open PR from branch",
  state: "open",
  isDraft: false,
  reviewDecision: null,
  checks: { total: 0, passed: 0, failed: 0, pending: 0 },
  checksState: "pending",
  checkRuns: [],
};

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 42,
    repoId: 7,
    taskRepos: [
      {
        repoId: 7,
        repoName: "nectus",
        branchName: "feat/github-detect",
        worktreePath: "/tmp/nectus/feat-github-detect",
        prUrl: null,
        isDirty: false,
        position: 0,
      },
    ],
    title: "Open PR from branch",
    prompt: "Find the PR.",
    status: "in_progress",
    prUrl: "https://github.com/hvp17/nectus/pull/123",
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: "feat/github-detect",
    worktreePath: "/tmp/nectus/feat-github-detect",
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: "2026-06-09T00:00:00.000Z",
    updatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.detectGithubPullRequest).mockResolvedValue(null);
  vi.mocked(api.githubPullRequestStatus).mockResolvedValue(linkedPullRequest);
  vi.mocked(api.githubStatus).mockResolvedValue(connectedStatus);
});

describe("useGithub", () => {
  it("hides cached pull request status when the selected task has no PR URL", async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.github.status(), connectedStatus);
    client.setQueryData(queryKeys.github.pullRequest(42), linkedPullRequest);

    const { result } = renderHook(
      () => useGithub({ selectedTask: task({ hasWorktree: false, prUrl: null }), applyTask: vi.fn() }),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.ghReady).toBe(true));

    expect(result.current.pullRequest).toBeNull();
    expect(result.current.pullRequestLoading).toBe(false);
    expect(api.githubPullRequestStatus).not.toHaveBeenCalled();
  });
});
