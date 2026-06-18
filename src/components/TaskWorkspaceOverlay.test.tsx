import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, resetAppStore } from "../test/testUtils";
import { api } from "../api";
import { TaskWorkspaceOverlay } from "./TaskWorkspaceOverlay";
import type { AgentProfile, ReviewLoop, TaskSummary } from "../types";

// The overlay's hooks (useGithub, useTaskReviewLoop, ACP chat, …) read
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
    listAcpProviders: vi.fn(),
    getTaskChat: vi.fn(),
    acpStartChat: vi.fn(),
    acpSendPrompt: vi.fn(),
    acpRespondPermission: vi.fn(),
    acpStopChat: vi.fn(),
    listChatCheckpoints: vi.fn(),
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
  mockedApi.listAcpProviders.mockResolvedValue([]);
  mockedApi.getTaskChat.mockResolvedValue({ session: null, messages: [] });
  mockedApi.listChatCheckpoints.mockResolvedValue([]);
});

describe("TaskWorkspaceOverlay reviewer config", () => {
  it("persists the reviewer choice via start_pair_loop (no run command)", async () => {
    renderWithProviders(<TaskWorkspaceOverlay task={reviewTask} backLabel="Board" onClose={vi.fn()} />);

    const reviewerTrigger = await screen.findByRole("button", { name: /change reviewer/i });
    fireEvent.keyDown(reviewerTrigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /claude review/i }));

    await waitFor(() => {
      expect(mockedApi.startPairLoop).toHaveBeenCalledWith(42, 2);
    });
    // The Review pane run command is retired — only config persists here.
    expect("runPairReview" in mockedApi).toBe(false);
  });
});
