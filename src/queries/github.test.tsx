import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "./queryClient";
import { queryKeys } from "./keys";
import { useGithubPullRequestDetectionQuery, useGithubPullRequestQuery } from "./github";
import type { PullRequestInfo, TaskSummary } from "../types";

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

vi.mock("../api", () => ({
  api: {
    detectGithubPullRequest: vi.fn(),
    githubPullRequestStatus: vi.fn(),
  },
}));

const taskWithoutPr: TaskSummary = {
  id: 42,
  repoId: 7,
  taskRepos: [],
  title: "Open PR from branch",
  prompt: "Find the PR.",
  status: "in_progress",
  prUrl: null,
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
};

const detectedTask: TaskSummary = {
  ...taskWithoutPr,
  prUrl: "https://github.com/hvp17/nectus/pull/123",
};

const pullRequestInfo: PullRequestInfo = {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.detectGithubPullRequest).mockResolvedValue(null);
  vi.mocked(api.githubPullRequestStatus).mockResolvedValue(pullRequestInfo);
});

describe("useGithubPullRequestDetectionQuery", () => {
  it("detects an existing pull request for a connected worktree task with no linked PR", async () => {
    vi.mocked(api.detectGithubPullRequest).mockResolvedValue(detectedTask);

    const { result } = renderHook(() => useGithubPullRequestDetectionQuery(taskWithoutPr, true), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(result.current.data).toEqual(detectedTask));
    expect(api.detectGithubPullRequest).toHaveBeenCalledWith(42);
  });

  it("stays idle when GitHub is disconnected or the task already has a PR", () => {
    renderHook(() => useGithubPullRequestDetectionQuery(taskWithoutPr, false), {
      wrapper: makeWrapper(),
    });
    renderHook(() => useGithubPullRequestDetectionQuery(detectedTask, true), {
      wrapper: makeWrapper(),
    });

    expect(api.detectGithubPullRequest).not.toHaveBeenCalled();
  });

  it("does not allocate sentinel cache entries while no task is selected", () => {
    const client = createQueryClient();
    const wrapper = makeWrapper(client);

    renderHook(() => useGithubPullRequestQuery(undefined, true), { wrapper });
    renderHook(() => useGithubPullRequestDetectionQuery(undefined, true), { wrapper });

    expect(client.getQueryCache().find({ queryKey: queryKeys.github.pullRequest(-1) })).toBeUndefined();
    expect(client.getQueryCache().find({ queryKey: queryKeys.github.pullRequestDetection(-1) })).toBeUndefined();
  });
});
