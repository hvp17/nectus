import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { renderWithProviders, resetAppStore } from "../../test/testUtils";
import { ChatPane } from "./ChatPane";
import type { ChatSession, ChatTranscript } from "../../types";

vi.mock("../../api", () => ({
  api: {
    getTaskChat: vi.fn(),
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

describe("ChatPane", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
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
});
