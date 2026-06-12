import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, resetAppStore } from "../test/testUtils";
import { api } from "../api";
import { TaskWorkspaceOverlay } from "./TaskWorkspaceOverlay";
import type { AgentProfile, ReviewLoop, TaskSummary } from "../types";

// The overlay's hooks (useGithub, useTaskReviewLoop, useSessionControls, …) read
// through `api`; mock the whole surface so the component mounts headlessly.
vi.mock("../api", () => ({
  api: {
    listTasks: vi.fn(),
    listAgentProfiles: vi.fn(),
    githubStatus: vi.fn(),
    detectGithubPullRequest: vi.fn(),
    getTaskReviewLoop: vi.fn(),
    listTaskReviewRuns: vi.fn(),
    jiraRestStatus: vi.fn(),
    startPairLoop: vi.fn(),
    runPairReview: vi.fn(),
    submitSessionInput: vi.fn(),
  },
}));
vi.mock("../lib/openExternal", () => ({ openExternal: vi.fn() }));

const mockedApi = vi.mocked(api, true);

const agentProfiles: AgentProfile[] = [
  { id: 1, name: "Codex", agentKind: "codex", command: "codex", model: null, args: [], env: {}, createdAt: "", updatedAt: "" },
  { id: 2, name: "Claude Review", agentKind: "claude", command: "claude", model: null, args: ["--print"], env: {}, createdAt: "", updatedAt: "" },
  { id: 3, name: "Antigravity", agentKind: "antigravity", command: "agy", model: null, args: [], env: {}, createdAt: "", updatedAt: "" },
];

const reviewTask: TaskSummary = {
  id: 42,
  repoId: 7,
  taskRepos: [],
  title: "Task under review",
  prompt: "Review the work.",
  status: "review",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/x",
  worktreePath: "/tmp/wt/feat-x",
  isDirty: false,
  archived: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

const runningLoop: ReviewLoop = {
  taskId: 42,
  reviewerProfileId: 2,
  status: "running",
  lastError: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAppStore();
  mockedApi.listTasks.mockResolvedValue([reviewTask]);
  mockedApi.listAgentProfiles.mockResolvedValue(agentProfiles);
  mockedApi.githubStatus.mockResolvedValue({ installed: false, authenticated: false });
  mockedApi.detectGithubPullRequest.mockResolvedValue(null);
  mockedApi.getTaskReviewLoop.mockResolvedValue(null);
  mockedApi.listTaskReviewRuns.mockResolvedValue([]);
  mockedApi.jiraRestStatus.mockResolvedValue({ connected: false, site: null, email: null, error: null });
  mockedApi.startPairLoop.mockResolvedValue(runningLoop);
  mockedApi.runPairReview.mockResolvedValue(runningLoop);
  mockedApi.submitSessionInput.mockResolvedValue(undefined);
});

describe("TaskWorkspaceOverlay review action", () => {
  it("starts the pair loop before running an immediate review", async () => {
    renderWithProviders(<TaskWorkspaceOverlay task={reviewTask} backLabel="Board" onClose={vi.fn()} />);

    const reviewButton = await screen.findByRole("button", { name: /review with claude review/i });
    reviewButton.click();

    await waitFor(() => {
      expect(mockedApi.startPairLoop).toHaveBeenCalledWith(42, 2);
      expect(mockedApi.runPairReview).toHaveBeenCalledWith(42);
    });
    // The loop must be (re)started before the immediate review runs.
    expect(mockedApi.startPairLoop.mock.invocationCallOrder[0]).toBeLessThan(
      mockedApi.runPairReview.mock.invocationCallOrder[0],
    );
  });
});
