import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createPrPrompt, mergePrPrompt } from "../lib/githubAgentPrompts";
import { useGithubShipActions } from "./useGithubShipActions";
import type { TaskSummary } from "../types";

vi.mock("../api", () => ({ api: { submitSessionInput: vi.fn() } }));
const mockedApi = vi.mocked(api, true);

const task: TaskSummary = {
  id: 42,
  repoId: 7,
  taskRepos: [],
  title: "Ship it",
  prompt: "do",
  status: "review",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/x",
  worktreePath: "/tmp/wt",
  isDirty: false,
  activeSessionId: "session-1",
  lastSessionId: "session-1",
  lastSessionAgent: "codex",
  lastSessionCwd: "/tmp/wt",
  lastSessionLabel: null,
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.submitSessionInput.mockResolvedValue(undefined);
});

describe("useGithubShipActions", () => {
  it("submits the create prompt into the running session", async () => {
    const setMessage = vi.fn();
    const setTaskAttention = vi.fn();
    const { result } = renderHook(() => useGithubShipActions({ setMessage, setTaskAttention }));

    await act(async () => {
      await result.current.createPullRequest(task, { draft: false });
    });

    expect(mockedApi.submitSessionInput).toHaveBeenCalledWith("session-1", createPrPrompt({ draft: false }));
    expect(setTaskAttention).toHaveBeenCalled();
  });

  it("submits the merge prompt with the chosen method", async () => {
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage: vi.fn(), setTaskAttention: vi.fn() }),
    );

    await act(async () => {
      await result.current.mergePullRequest(task, "rebase");
    });

    expect(mockedApi.submitSessionInput).toHaveBeenCalledWith("session-1", mergePrPrompt("rebase"));
  });

  it("declines with guidance when no session is running", async () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage, setTaskAttention: vi.fn() }),
    );

    await act(async () => {
      await result.current.closePullRequest({ ...task, activeSessionId: null });
    });

    expect(mockedApi.submitSessionInput).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringMatching(/start or resume the agent/i));
  });
});
