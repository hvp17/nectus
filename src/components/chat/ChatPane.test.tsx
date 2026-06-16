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
    acpCancelPrompt: vi.fn(),
    acpSetSessionMode: vi.fn(),
    acpSetConfigOption: vi.fn(),
    acpStopChat: vi.fn(),
    listChatCheckpoints: vi.fn().mockResolvedValue([]),
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

const runtimeSession: ChatSession = {
  ...staleSession,
  acpSessionId: "acp-123",
  runtime: {
    capabilities: {
      loadSession: true,
      prompt: { image: true, audio: false, embeddedContext: true },
      mcp: { http: false, sse: false },
    },
    agentInfo: { name: "claude", title: "Claude Code", version: "1.0.0" },
    authMethods: [],
    availableCommands: [
      { name: "plan", description: "Create a plan", inputHint: "Describe the goal" },
    ],
    modes: [
      { id: "plan", name: "Plan" },
      { id: "code", name: "Code" },
    ],
    currentModeId: "plan",
    configOptions: [
      {
        id: "model",
        name: "Model",
        currentValue: "sonnet",
        options: [
          { id: "sonnet", name: "Sonnet" },
          { id: "opus", name: "Opus" },
        ],
      },
    ],
    title: "Implement ACP polish",
    updatedAt: "2026-06-15T00:03:00.000Z",
  },
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
        maturity: "stable",
      },
      {
        id: "opencode",
        agentKind: "opencode",
        displayName: "OpenCode",
        launch: { command: "opencode", args: ["acp"] },
        capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
        maturity: "preview",
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

    await waitFor(() => expect(mockedApi.getTaskChat).toHaveBeenCalled());
    const input = await screen.findByTestId("chat-composer-input");
    fireEvent.change(input, { target: { value: "What is 2+2?" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    await waitFor(() => expect(mockedApi.acpStartChat).toHaveBeenCalledWith(42, 2));
    expect(mockedApi.acpSendPrompt).toHaveBeenNthCalledWith(
      1,
      "stale-session",
      "What is 2+2?",
      undefined,
    );
    expect(mockedApi.acpSendPrompt).toHaveBeenNthCalledWith(
      2,
      "fresh-session",
      "What is 2+2?",
      undefined,
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
    expect(mockedApi.acpSendPrompt).toHaveBeenCalledWith("opencode-session", "Use OpenCode", undefined);
    expect(mockedApi.acpSendPrompt).not.toHaveBeenCalledWith("stale-session", "Use OpenCode");
  });

  it("disables the composer when the task agent has no ACP provider descriptor", async () => {
    const transcript: ChatTranscript = { session: null, messages: [] };
    mockedApi.getTaskChat.mockResolvedValue(transcript);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 3,
        name: "Custom shell",
        agentKind: "custom",
        command: "my-agent",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z",
      },
    ]);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={3} />);

    expect(await screen.findByText("ACP chat unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Custom shell does not have an ACP provider descriptor yet."),
    ).toBeInTheDocument();
    const input = screen.getByTestId("chat-composer-input");
    expect(input).toBeDisabled();
    expect(screen.getByTestId("chat-send")).toBeDisabled();

    fireEvent.change(input, { target: { value: "Try anyway" } });
    fireEvent.click(screen.getByTestId("chat-send"));

    expect(mockedApi.acpStartChat).not.toHaveBeenCalled();
  });

  it("uses runtime capabilities for image attach and resume affordances", async () => {
    mockedApi.getTaskChat.mockResolvedValue({
      session: {
        ...runtimeSession,
        runtime: {
          ...runtimeSession.runtime!,
          capabilities: {
            ...runtimeSession.runtime!.capabilities,
            loadSession: false,
            prompt: {
              ...runtimeSession.runtime!.capabilities.prompt,
              image: false,
            },
          },
        },
      },
      messages: [],
    });

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    expect(await screen.findByText("Implement ACP polish")).toBeInTheDocument();
    expect(screen.queryByLabelText("Attach image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("chat-resume-badge")).not.toBeInTheDocument();
  });

  it("exposes slash commands by inserting the selected command into the composer", async () => {
    mockedApi.getTaskChat.mockResolvedValue({ session: runtimeSession, messages: [] });

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    const menu = await screen.findByTestId("chat-command-menu");
    menu.focus();
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByText("/plan"));

    expect(screen.getByTestId("chat-composer-input")).toHaveValue("/plan ");
  });

  it("sends mode and config changes to the live ACP session", async () => {
    mockedApi.getTaskChat.mockResolvedValue({ session: runtimeSession, messages: [] });
    mockedApi.acpSetSessionMode.mockResolvedValue(undefined);
    mockedApi.acpSetConfigOption.mockResolvedValue(undefined);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    fireEvent.click(await screen.findByRole("combobox", { name: "Session mode" }));
    fireEvent.click(await screen.findByRole("option", { name: "Code" }));
    expect(mockedApi.acpSetSessionMode).toHaveBeenCalledWith("stale-session", "code");

    fireEvent.click(screen.getByRole("combobox", { name: "Session config Model" }));
    fireEvent.click(await screen.findByRole("option", { name: "Opus" }));
    expect(mockedApi.acpSetConfigOption).toHaveBeenCalledWith("stale-session", "model", "opus");
  });

  it("reflects the selected model in the trigger immediately (no server echo)", async () => {
    mockedApi.getTaskChat.mockResolvedValue({ session: runtimeSession, messages: [] });
    mockedApi.acpSetConfigOption.mockResolvedValue(undefined);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    const trigger = await screen.findByRole("combobox", { name: "Session config Model" });
    expect(trigger).toHaveTextContent("Sonnet");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Opus" }));

    expect(trigger).toHaveTextContent("Opus");
  });

  it("does not change the model field when the mode changes", async () => {
    mockedApi.getTaskChat.mockResolvedValue({ session: runtimeSession, messages: [] });
    mockedApi.acpSetSessionMode.mockResolvedValue(undefined);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    const modeTrigger = await screen.findByRole("combobox", { name: "Session mode" });
    const modelTrigger = screen.getByRole("combobox", { name: "Session config Model" });
    expect(modelTrigger).toHaveTextContent("Sonnet");

    fireEvent.click(modeTrigger);
    fireEvent.click(await screen.findByRole("option", { name: "Code" }));

    expect(modelTrigger).toHaveTextContent("Sonnet");
  });

  it("uses graceful ACP cancel for the stop button", async () => {
    mockedApi.getTaskChat.mockResolvedValue({
      session: runtimeSession,
      messages: [
        {
          id: "agent-live",
          role: "agent",
          parts: [{ type: "text", text: "Working" }],
          createdAt: "2026-06-15T00:04:00.000Z",
          completedAt: null,
        },
      ],
    });
    mockedApi.acpCancelPrompt.mockResolvedValue(undefined);

    renderWithProviders(<ChatPane taskId={42} agentProfileId={2} />);

    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

    expect(mockedApi.acpCancelPrompt).toHaveBeenCalledWith("stale-session");
    expect(mockedApi.acpStopChat).not.toHaveBeenCalled();
  });
});
