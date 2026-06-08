import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import { api } from "../api";
import type { AgentProfile, Session, TaskSummary } from "../types";
import { useSessionCommands } from "./useSessionCommands";

vi.mock("../api", () => ({
  api: {
    startSession: vi.fn(),
    stopSession: vi.fn(),
    resumeSession: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const createdAt = "2026-06-09T00:00:00.000Z";

function profile(overrides: Partial<AgentProfile> & { id: number }): AgentProfile {
  return {
    id: overrides.id,
    name: overrides.name ?? `Agent ${overrides.id}`,
    agentKind: overrides.agentKind ?? "codex",
    command: overrides.command ?? "codex",
    model: overrides.model ?? null,
    args: overrides.args ?? [],
    env: overrides.env ?? {},
    createdAt,
    updatedAt: createdAt,
  };
}

function task(overrides: Partial<TaskSummary> & { id: number }): TaskSummary {
  return {
    id: overrides.id,
    repoId: overrides.repoId ?? 1,
    title: overrides.title ?? `Task ${overrides.id}`,
    status: overrides.status ?? "planned",
    agentProfileId: overrides.agentProfileId ?? null,
    hasWorktree: overrides.hasWorktree ?? false,
    isDirty: overrides.isDirty ?? false,
    activeSessionId: overrides.activeSessionId ?? null,
    lastSessionId: overrides.lastSessionId ?? null,
    lastSessionLabel: overrides.lastSessionLabel ?? null,
    taskRepos: overrides.taskRepos ?? [
      { repoId: overrides.repoId ?? 1, repoName: "nectus", isDirty: false, position: 0 },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

function session(overrides: Partial<Session> & { taskId: number }): Session {
  return {
    id: overrides.id ?? "session-1",
    taskId: overrides.taskId,
    agentProfileId: overrides.agentProfileId ?? 1,
    state: overrides.state ?? "running",
    resumableSessionId: overrides.resumableSessionId ?? null,
    resumableSessionLabel: overrides.resumableSessionLabel ?? null,
    startedAt: createdAt,
    stoppedAt: overrides.stoppedAt ?? null,
  };
}

function setup({
  agentProfiles = [profile({ id: 1 }), profile({ id: 2 })],
  selectedAgentProfileId,
  initialTasks = [task({ id: 7 })],
}: {
  agentProfiles?: AgentProfile[];
  selectedAgentProfileId?: number;
  initialTasks?: TaskSummary[];
} = {}) {
  let tasks = initialTasks;
  let selectedTaskId: number | undefined;
  let message: string | null = "stale";

  const setMessage = vi.fn((value: SetStateAction<string | null>) => {
    message = typeof value === "function" ? value(message) : value;
  });
  const setSelectedTaskId = vi.fn((value: SetStateAction<number | undefined>) => {
    selectedTaskId = typeof value === "function" ? value(selectedTaskId) : value;
  });
  const setTasks = vi.fn((value: SetStateAction<TaskSummary[]>) => {
    tasks = typeof value === "function" ? value(tasks) : value;
  });

  const hook = renderHook(() =>
    useSessionCommands({
      agentProfiles,
      selectedAgentProfileId,
      setMessage,
      setSelectedTaskId,
      setTasks,
    }),
  );

  return {
    ...hook,
    message: () => message,
    selectedTaskId: () => selectedTaskId,
    tasks: () => tasks,
  };
}

describe("useSessionCommands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a task with its saved agent profile and applies the running session", async () => {
    const selectedTask = task({ id: 7, agentProfileId: 2, lastSessionLabel: "Previous" });
    mockedApi.startSession.mockResolvedValue(
      session({
        id: "session-7",
        taskId: selectedTask.id,
        agentProfileId: 2,
        resumableSessionId: "resume-7",
        resumableSessionLabel: "Codex resume",
      }),
    );
    const { result, message, selectedTaskId, tasks } = setup({
      selectedAgentProfileId: 1,
      initialTasks: [selectedTask],
    });

    await act(async () => {
      await result.current.startSession(selectedTask);
    });

    expect(mockedApi.startSession).toHaveBeenCalledWith(7, 2);
    expect(message()).toBeNull();
    expect(selectedTaskId()).toBe(7);
    expect(tasks()[0]).toMatchObject({
      activeSessionId: "session-7",
      lastSessionId: "resume-7",
      lastSessionLabel: "Codex resume",
    });
  });

  it("does not start a task when no agent profile can be resolved", async () => {
    const selectedTask = task({ id: 8, agentProfileId: null });
    const { result, tasks } = setup({ agentProfiles: [], initialTasks: [selectedTask] });

    await act(async () => {
      await result.current.startSession(selectedTask);
    });

    expect(mockedApi.startSession).not.toHaveBeenCalled();
    expect(tasks()[0]).toEqual(selectedTask);
  });

  it("stops a session and preserves resumable metadata", async () => {
    const selectedTask = task({ id: 7, activeSessionId: "session-7", lastSessionLabel: "Previous" });
    mockedApi.stopSession.mockResolvedValue(
      session({
        id: "session-7",
        taskId: selectedTask.id,
        state: "stopped",
        resumableSessionId: "resume-7",
        resumableSessionLabel: "Stopped session",
      }),
    );
    const { result, tasks } = setup({ initialTasks: [selectedTask] });

    await act(async () => {
      await result.current.stopSession("session-7");
    });

    expect(mockedApi.stopSession).toHaveBeenCalledWith("session-7");
    expect(tasks()[0]).toMatchObject({
      activeSessionId: null,
      lastSessionId: "resume-7",
      lastSessionLabel: "Stopped session",
    });
  });

  it("clears the matching active session id on exit", () => {
    const firstTask = task({ id: 7, activeSessionId: "session-7" });
    const secondTask = task({ id: 8, activeSessionId: "session-8" });
    const { result, tasks } = setup({ initialTasks: [firstTask, secondTask] });

    act(() => {
      result.current.onSessionExit("session-7");
    });

    expect(tasks()).toMatchObject([
      { id: 7, activeSessionId: null },
      { id: 8, activeSessionId: "session-8" },
    ]);
  });
});
