import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSessionEvents } from "./useSessionEvents";
import type { TaskSummary } from "../types";

// Capture the handlers `useSessionEvents` registers so tests can fire events
// without a Tauri backend. `vi.hoisted` keeps the shared state available to the
// hoisted `vi.mock` factory.
const { listeners, listenMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const listenMock = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  });
  return { listeners, listenMock };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

const baseTask: TaskSummary = {
  id: 7,
  repoId: 1,
  title: "Stream agent activity",
  prompt: null,
  status: "in_progress",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/activity",
  worktreePath: "/tmp/wt/activity",
  isDirty: false,
  activeSessionId: "s-1",
  lastSessionId: "s-1",
  lastSessionAgent: "codex",
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

function setup(initialTasks: TaskSummary[]) {
  const tasksRef = { current: initialTasks };
  let liveLines: Record<number, string> = {};
  const setLiveLines = vi.fn(
    (update: React.SetStateAction<Record<number, string>>) => {
      liveLines = typeof update === "function" ? update(liveLines) : update;
    },
  );
  renderHook(() =>
    useSessionEvents({
      tasksRef,
      setTasks: vi.fn((update) => {
        tasksRef.current =
          typeof update === "function" ? update(tasksRef.current) : update;
      }),
      setMessage: vi.fn(),
      setTaskToast: vi.fn(),
      setTaskAttention: vi.fn(),
      setLiveLines,
    }),
  );
  return { getLiveLines: () => liveLines };
}

describe("useSessionEvents live activity", () => {
  beforeEach(() => {
    listeners.clear();
    listenMock.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("records the live activity line for a task", async () => {
    const { getLiveLines } = setup([baseTask]);
    await waitFor(() => expect(listeners.has("session_activity")).toBe(true));

    act(() => {
      listeners.get("session_activity")?.({
        payload: { sessionId: "s-1", taskId: 7, line: "Running tests" },
      });
    });

    expect(getLiveLines()).toEqual({ 7: "Running tests" });
  });

  it("clears the live line when its session exits", async () => {
    const { getLiveLines } = setup([baseTask]);
    await waitFor(() => expect(listeners.has("session_activity")).toBe(true));

    act(() => {
      listeners.get("session_activity")?.({
        payload: { sessionId: "s-1", taskId: 7, line: "Running tests" },
      });
    });
    expect(getLiveLines()).toEqual({ 7: "Running tests" });

    act(() => {
      listeners.get("session_exited")?.({ payload: { sessionId: "s-1" } });
    });

    expect(getLiveLines()).toEqual({});
  });
});
