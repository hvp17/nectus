import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { createQueryClient } from "../queries/queryClient";
import { createPrPrompt, mergePrPrompt } from "../lib/githubAgentPrompts";
import { useGithubShipActions } from "./useGithubShipActions";
import type { AcpProviderInfo, TaskSummary } from "../types";

vi.mock("../api", () => ({
  api: {
    listAcpProviders: vi.fn(),
    acpStartChat: vi.fn(),
    acpSendPrompt: vi.fn(),
  },
}));
const mockedApi = vi.mocked(api, true);

const acpProviders: AcpProviderInfo[] = [
  {
    id: "codex",
    agentKind: "codex",
    displayName: "Codex",
    launch: { command: "codex-acp", args: [] },
    capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
    maturity: "preview",
  },
];

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
  archived: false,
  activeSessionId: "session-1",
  lastSessionId: "session-1",
  lastSessionAgent: "codex",
  lastSessionCwd: "/tmp/wt",
  lastSessionLabel: null,
  createdAt: "2026-06-07T00:00:00.000Z",
  updatedAt: "2026-06-07T00:00:00.000Z",
};

function renderShipHook() {
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.task.chat(42, 1), {
    session: { id: "chat-1", taskId: 42, agentProfileId: 1, acpSessionId: null, cwd: "/tmp/wt", createdAt: "", updatedAt: "" },
    messages: [],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.listAcpProviders.mockResolvedValue(acpProviders);
  mockedApi.acpSendPrompt.mockResolvedValue(undefined);
});

describe("useGithubShipActions", () => {
  it("submits the create prompt through ACP chat for capable agents", async () => {
    const setMessage = vi.fn();
    const setTaskAttention = vi.fn();
    const { wrapper } = renderShipHook();
    const { result } = renderHook(() => useGithubShipActions({ setMessage, setTaskAttention }), { wrapper });

    await act(async () => {
      await result.current.createPullRequest(task, { draft: false });
    });

    expect(mockedApi.acpSendPrompt).toHaveBeenCalledWith("chat-1", createPrPrompt({ draft: false }));
    expect(setTaskAttention).toHaveBeenCalled();
  });

  it("submits the merge prompt with the chosen method", async () => {
    const { wrapper } = renderShipHook();
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage: vi.fn(), setTaskAttention: vi.fn() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.mergePullRequest(task, "rebase");
    });

    expect(mockedApi.acpSendPrompt).toHaveBeenCalledWith("chat-1", mergePrPrompt("rebase"));
  });

  it("starts chat when shipping without a cached session", async () => {
    mockedApi.acpStartChat.mockResolvedValue({
      id: "chat-new",
      taskId: 42,
      agentProfileId: 1,
      acpSessionId: null,
      cwd: "/tmp/wt",
      createdAt: "",
      updatedAt: "",
    });
    const queryClient = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage: vi.fn(), setTaskAttention: vi.fn() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.setPullRequestReady({ ...task, activeSessionId: null });
    });

    expect(mockedApi.acpStartChat).toHaveBeenCalledWith(42, 1);
    expect(mockedApi.acpSendPrompt).toHaveBeenCalled();
  });

  it("declines with guidance when an agent has no ACP provider even if a legacy session is active", async () => {
    mockedApi.listAcpProviders.mockResolvedValue([]);
    const setMessage = vi.fn();
    const { wrapper } = renderShipHook();
    const { result } = renderHook(() =>
      useGithubShipActions({ setMessage, setTaskAttention: vi.fn() }),
      { wrapper },
    );

    await act(async () => {
      await result.current.closePullRequest({ ...task, agentKind: "custom", activeSessionId: "legacy-session" });
    });

    expect(mockedApi.acpSendPrompt).not.toHaveBeenCalled();
    expect(setMessage).toHaveBeenCalledWith(expect.stringMatching(/ACP chat/i));
  });
});
