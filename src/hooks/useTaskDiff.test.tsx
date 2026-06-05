import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useTaskDiff } from "./useTaskDiff";
import type { TaskDiffSummary } from "../types";

const eventTestState = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventTestState.handlers.set(eventName, handler);
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: eventTestState.listen }));
vi.mock("../sessionNotifications", () => ({ isTauriRuntime: () => true }));
vi.mock("../api", () => ({
  api: {
    taskDiffSummary: vi.fn(),
    taskDiffFile: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const summary: TaskDiffSummary = {
  baseLabel: "origin/main",
  files: [{ path: "src/a.ts", change: "modified", additions: 2, deletions: 1, binary: false }],
};

beforeEach(() => {
  eventTestState.handlers.clear();
  eventTestState.listen.mockClear();
  mockedApi.taskDiffSummary.mockReset();
  mockedApi.taskDiffFile.mockReset();
});

describe("useTaskDiff", () => {
  it("loads the changed-file summary on refresh", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useTaskDiff(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledWith(1);
    expect(result.current.summary).toEqual(summary);
  });

  it("lazy-loads and caches a file patch", async () => {
    mockedApi.taskDiffFile.mockResolvedValue("@@ -1 +1 @@\n+x");
    const { result } = renderHook(() => useTaskDiff(1));
    await act(async () => {
      await result.current.loadFile("src/a.ts");
    });
    expect(mockedApi.taskDiffFile).toHaveBeenCalledWith(1, "src/a.ts");
    expect(result.current.files["src/a.ts"]).toMatchObject({ patch: "@@ -1 +1 @@\n+x", loading: false });
  });

  it("refreshes when the task's session goes idle after the diff was opened", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useTaskDiff(7));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1);

    const handler = eventTestState.handlers.get("session_idle");
    expect(handler).toBeTruthy();
    await act(async () => {
      handler?.({ payload: { sessionId: "s", taskId: 7 } });
    });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(2));
  });

  it("ignores idle events for other tasks", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useTaskDiff(7));
    await act(async () => {
      await result.current.refresh();
    });
    const handler = eventTestState.handlers.get("session_idle");
    await act(async () => {
      handler?.({ payload: { sessionId: "s", taskId: 99 } });
    });
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1);
  });

  it("clears the summary when the task changes", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result, rerender } = renderHook(({ id }) => useTaskDiff(id), {
      initialProps: { id: 1 },
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.summary).toEqual(summary);
    rerender({ id: 2 });
    expect(result.current.summary).toBeNull();
  });
});
