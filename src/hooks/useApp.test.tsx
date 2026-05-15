import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useApp } from "./useApp";
import type { SessionIdleEvent, TaskSummary } from "../types";

const eventTestState = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventTestState.handlers.set(eventName, handler);
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventTestState.listen,
}));

vi.mock("../api", () => ({
  api: {
    listRepos: vi.fn(),
    listAgentProfiles: vi.fn(),
    listTasks: vi.fn(),
    getAppSettings: vi.fn(),
    sendSystemNotification: vi.fn().mockResolvedValue(true),
  },
}));

const mockedApi = vi.mocked(api);

const activeTask: TaskSummary = {
  id: 21,
  repoId: 7,
  title: "Continue stale attention",
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/stale-attention",
  worktreePath: "/tmp/stale-attention",
  isDirty: false,
  activeSessionId: "session-21",
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T00:00:00.000Z",
};

function Harness() {
  const app = useApp();

  return (
    <>
      <output data-testid="tasks">{app.tasks.length}</output>
      <output data-testid="finished">{app.counts.finished}</output>
      <button type="button" onClick={() => app.onSessionInput("session-21")}>
        send input
      </button>
    </>
  );
}

describe("useApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventTestState.handlers.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    mockedApi.listRepos.mockResolvedValue([
      {
        id: 7,
        name: "nectus-desktop",
        path: "/tmp/nectus-desktop",
        defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
        createdAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 1,
        name: "Codex",
        agentKind: "codex",
        command: "codex",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.getAppSettings.mockResolvedValue({
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "../{repoName}-worktrees",
      defaultBranchPrefix: null,
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    mockedApi.listTasks.mockResolvedValue([activeTask]);
  });

  it("clears finished attention when input is sent to that active session", async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByTestId("tasks")).toHaveTextContent("1");
    });
    await waitFor(() => {
      expect(eventTestState.handlers.has("session_idle")).toBe(true);
    });

    act(() => {
      eventTestState.handlers.get("session_idle")?.({
        payload: {
          sessionId: "session-21",
          taskId: activeTask.id,
          turnId: "turn-1",
          message: "Ready for next instruction",
        } satisfies SessionIdleEvent,
      });
    });

    expect(screen.getByTestId("finished")).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: /send input/i }));

    expect(screen.getByTestId("finished")).toHaveTextContent("0");
  });
});
