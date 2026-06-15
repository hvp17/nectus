import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { renderWithProviders, resetAppStore } from "../../test/testUtils";
import { ChatPane } from "./ChatPane";
import type { ChatSession, ChatTranscript } from "../../types";

vi.mock("../../api", () => ({
  api: {
    getTaskChat: vi.fn(),
    listAgentProfiles: vi.fn(),
    listAcpProviders: vi.fn(),
    acpStartChat: vi.fn(),
    acpSendPrompt: vi.fn(),
    acpRespondPermission: vi.fn(),
    acpStopChat: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api, true);

const staleSession: ChatSession = {
  id: "stale-session",
  taskId: 42,
  agentProfileId: 2,
  acpSessionId: null,
  cwd: "/tmp/worktree",
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
};

const restartedSession: ChatSession = {
  ...staleSession,
  id: "fresh-session",
  updatedAt: "2026-06-15T00:01:00.000Z",
};

const opencodeSession: ChatSession = {
  ...staleSession,
  id: "opencode-session",
  agentProfileId: 4,
  updatedAt: "2026-06-15T00:02:00.000Z",
};

describe("ChatPane", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 2,
        name: "Claude Sonnet",
        agentKind: "claude",
        command: "claude",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
      {
        id: 4,
        name: "OpenCode",
        agentKind: "opencode",
        command: "opencode",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
    ]);
    mockedApi.listAcpProviders.mockResolvedValue([
      {
        id: "claude",
        agentKind: "claude",
        displayName: "Claude Code",
        launch: { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
        capabilities: { sessionLoad: "expected", permissions: "expected", images: "unknown" },
      },
      {
        id: "opencode",
        agentKind: "opencode",
        displayName: "OpenCode",
        launch: { command: "opencode", args: ["acp"] },
        capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
      },
    ]);
  });

  it("restarts and resends when a persisted session is no longer live", async () => {
    const transcript: ChatTranscript = { session: staleSession, messages: [] };
    mockedApi.getTaskChat.mockResolvedValue(transcript);
    mockedApi.acpSendPrompt
      .mockRejectedValueOnce(new Error("No such chat session"))
      .mockResolvedValueOnce(undefined);
    mockedApi.acpStartChat.mockResolvedValue(restartedSession);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    const input = await screen.findByTestId("chat-composer-input");
    fireEvent.change(input, { target: { value: "What is 2+2?" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(mockedApi.acpStartChat).toHaveBeenCalledWith(42, 2));
    expect(mockedApi.acpSendPrompt).toHaveBeenNthCalledWith(
      1,
      "stale-session",
      "What is 2+2?",
    );
    expect(mockedApi.acpSendPrompt).toHaveBeenNthCalledWith(
      2,
      "fresh-session",
      "What is 2+2?",
    );
  });

  it("starts a new ACP chat for the selected provider instead of sending to another profile's session", async () => {
    mockedApi.getTaskChat.mockImplementation((_taskId, profileId) =>
      Promise.resolve(
        profileId === 4
          ? { session: null, messages: [] }
          : { session: staleSession, messages: [] },
      ),
    );
    mockedApi.acpStartChat.mockResolvedValue(opencodeSession);
    mockedApi.acpSendPrompt.mockResolvedValue(undefined);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={4} />);

    expect(await screen.findByText("OpenCode ACP")).toBeInTheDocument();
    const input = screen.getByTestId("chat-composer-input");
    fireEvent.change(input, { target: { value: "Use OpenCode" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(mockedApi.acpStartChat).toHaveBeenCalledWith(42, 4));
    expect(mockedApi.acpSendPrompt).toHaveBeenCalledWith("opencode-session", "Use OpenCode");
    expect(mockedApi.acpSendPrompt).not.toHaveBeenCalledWith("stale-session", "Use OpenCode");
  });

  it("disables the composer when the task agent has no ACP provider descriptor", async () => {
    const transcript: ChatTranscript = { session: null, messages: [] };
    mockedApi.getTaskChat.mockResolvedValue(transcript);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 3,
        name: "Antigravity",
        agentKind: "antigravity",
        command: "agy",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
    ]);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={3} />);

    expect(await screen.findByText("ACP chat unavailable")).toBeInTheDocument();
    expect(screen.getByText("Antigravity does not have an ACP provider descriptor yet. Use Terminal for this task.")).toBeInTheDocument();
    const input = screen.getByTestId("chat-composer-input");
    expect(input).toBeDisabled();
    expect(screen.getByTestId("chat-send")).toBeDisabled();

    fireEvent.change(input, { target: { value: "Try anyway" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(mockedApi.acpStartChat).not.toHaveBeenCalled();
  });
});
