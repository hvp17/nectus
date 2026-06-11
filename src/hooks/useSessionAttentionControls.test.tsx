import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MutableRefObject, SetStateAction } from "react";
import type { TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";
import { useSessionAttentionControls } from "./useSessionAttentionControls";

const updatedAt = "2026-06-09T00:00:00.000Z";

function task(overrides: Partial<TaskSummary> & { id: number }): TaskSummary {
  return {
    id: overrides.id,
    repoId: overrides.repoId ?? 1,
    title: overrides.title ?? `Task ${overrides.id}`,
    status: overrides.status ?? "in_progress",
    hasWorktree: overrides.hasWorktree ?? false,
    isDirty: overrides.isDirty ?? false,
    archived: overrides.archived ?? false,
    activeSessionId: overrides.activeSessionId ?? null,
    taskRepos: overrides.taskRepos ?? [
      { repoId: overrides.repoId ?? 1, repoName: "nectus", isDirty: false, position: 0 },
    ],
    createdAt: updatedAt,
    updatedAt,
  };
}

function attention(taskId: number): TaskAttention {
  return {
    taskId,
    kind: "needs_input",
    title: `Task ${taskId}`,
    reason: "approval",
    updatedAt,
  };
}

function setup({
  tasks = [task({ id: 7, activeSessionId: "session-7" }), task({ id: 8, activeSessionId: "session-8" })],
  initialAttention = [attention(7), attention(8)],
}: {
  tasks?: TaskSummary[];
  initialAttention?: TaskAttention[];
} = {}) {
  let currentAttention = initialAttention;
  const setTaskAttention = vi.fn((value: SetStateAction<TaskAttention[]>) => {
    currentAttention = typeof value === "function" ? value(currentAttention) : value;
  });
  const sessionCommands = {
    startSession: vi.fn().mockResolvedValue(undefined),
    resumeSession: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    onSessionExit: vi.fn(),
  };
  const tasksRef = { current: tasks } as MutableRefObject<TaskSummary[]>;

  const hook = renderHook(() =>
    useSessionAttentionControls({
      tasksRef,
      setTaskAttention,
      sessionCommands,
    }),
  );

  return {
    ...hook,
    attention: () => currentAttention,
    sessionCommands,
  };
}

describe("useSessionAttentionControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears task attention before starting a session", async () => {
    const selectedTask = task({ id: 7 });
    const { result, attention: currentAttention, sessionCommands } = setup();

    await act(async () => {
      await result.current.startSession(selectedTask);
    });

    expect(currentAttention().map((entry) => entry.taskId)).toEqual([8]);
    expect(sessionCommands.startSession).toHaveBeenCalledWith(selectedTask);
  });

  it("clears task attention before resuming a session", async () => {
    const selectedTask = task({ id: 8 });
    const { result, attention: currentAttention, sessionCommands } = setup();

    await act(async () => {
      await result.current.resumeSession(selectedTask);
    });

    expect(currentAttention().map((entry) => entry.taskId)).toEqual([7]);
    expect(sessionCommands.resumeSession).toHaveBeenCalledWith(selectedTask);
  });

  it("clears attention for the task that owns a stopped or exited session", async () => {
    const { result, attention: currentAttention, sessionCommands } = setup();

    await act(async () => {
      await result.current.stopSession("session-7");
    });
    expect(currentAttention().map((entry) => entry.taskId)).toEqual([8]);
    expect(sessionCommands.stopSession).toHaveBeenCalledWith("session-7");

    act(() => {
      result.current.onSessionExit("session-8");
    });
    expect(currentAttention()).toEqual([]);
    expect(sessionCommands.onSessionExit).toHaveBeenCalledWith("session-8");
  });

  it("clears attention when input is sent into a matching session", () => {
    const { result, attention: currentAttention } = setup();

    act(() => {
      result.current.onSessionInput("session-7");
    });

    expect(currentAttention().map((entry) => entry.taskId)).toEqual([8]);
  });

  it("leaves attention unchanged when a session id is not attached to a task", async () => {
    const { result, attention: currentAttention, sessionCommands } = setup();

    await act(async () => {
      await result.current.stopSession("missing-session");
    });

    expect(currentAttention().map((entry) => entry.taskId)).toEqual([7, 8]);
    expect(sessionCommands.stopSession).toHaveBeenCalledWith("missing-session");
  });

  it("keeps returned command wrappers stable while inputs are unchanged", () => {
    const { result, rerender } = setup();
    const first = result.current;

    rerender();

    expect(result.current.startSession).toBe(first.startSession);
    expect(result.current.resumeSession).toBe(first.resumeSession);
    expect(result.current.stopSession).toBe(first.stopSession);
    expect(result.current.onSessionExit).toBe(first.onSessionExit);
    expect(result.current.onSessionInput).toBe(first.onSessionInput);
  });
});
