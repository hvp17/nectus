import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { deferred } from "../test/testUtils";
import { useTaskDiff } from "./useTaskDiff";
import type { TaskDiffSummary } from "../types";

/** A renderHook wrapper with its own fresh QueryClient (isolated cache per test). */
function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const eventTestState = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>(),
  listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
    eventTestState.handlers.set(eventName, handler);
    return vi.fn();
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: eventTestState.listen }));
vi.mock("../lib/tauriRuntime", () => ({ isTauriRuntime: () => true }));
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

const summary2: TaskDiffSummary = {
  baseLabel: "origin/main",
  files: [{ path: "src/b.ts", change: "added", additions: 5, deletions: 0, binary: false }],
};

beforeEach(() => {
  eventTestState.handlers.clear();
  eventTestState.listen.mockClear();
  mockedApi.taskDiffSummary.mockReset();
  mockedApi.taskDiffFile.mockReset();
});

describe("useTaskDiff", () => {
  it("does not allocate a placeholder summary query while no task is selected", () => {
    const client = createQueryClient();
    renderHook(() => useTaskDiff(undefined), { wrapper: makeWrapper(client) });

    expect(client.getQueryCache().find({ queryKey: ["task", "diff-summary", "none"] })).toBeUndefined();
    expect(client.getQueryCache().find({ queryKey: queryKeys.task.diffSummary(undefined) })).toBeUndefined();
    expect(mockedApi.taskDiffSummary).not.toHaveBeenCalled();
  });

  it("hides cached summary data while no task is selected", () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.task.diffSummary(undefined), summary);

    const { result } = renderHook(() => useTaskDiff(undefined), { wrapper: makeWrapper(client) });

    expect(result.current.summary).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockedApi.taskDiffSummary).not.toHaveBeenCalled();
  });

  it("loads the changed-file summary as soon as a task is selected", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useTaskDiff(1), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.summary).toEqual(summary));
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledWith(1);
  });

  it("reloads the summary on manual refresh", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    const { result } = renderHook(() => useTaskDiff(1), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(2);
  });

  it("lazy-loads and caches a file patch", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    mockedApi.taskDiffFile.mockResolvedValue("@@ -1 +1 @@\n+x");
    const { result } = renderHook(() => useTaskDiff(1), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalled());
    await act(async () => {
      await result.current.loadFile("src/a.ts");
    });
    expect(mockedApi.taskDiffFile).toHaveBeenCalledWith(1, "src/a.ts");
    expect(result.current.files["src/a.ts"]).toMatchObject({ patch: "@@ -1 +1 @@\n+x", loading: false });
  });

  it("refreshes when the task's session goes idle, even before the diff is opened", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    renderHook(() => useTaskDiff(7), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1));

    const handler = eventTestState.handlers.get("session_idle");
    expect(handler).toBeTruthy();
    await act(async () => {
      handler?.({ payload: { sessionId: "s", taskId: 7 } });
    });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(2));
  });

  it("ignores idle events for other tasks", async () => {
    mockedApi.taskDiffSummary.mockResolvedValue(summary);
    renderHook(() => useTaskDiff(7), { wrapper: makeWrapper() });
    await waitFor(() => expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1));
    const handler = eventTestState.handlers.get("session_idle");
    await act(async () => {
      handler?.({ payload: { sessionId: "s", taskId: 99 } });
    });
    expect(mockedApi.taskDiffSummary).toHaveBeenCalledTimes(1);
  });

  it("clears the stale summary and reloads when the task changes", async () => {
    const second = deferred<TaskDiffSummary>();
    mockedApi.taskDiffSummary.mockImplementation((id: number) =>
      id === 2 ? second.promise : Promise.resolve(summary),
    );
    const { result, rerender } = renderHook(({ id }) => useTaskDiff(id), { initialProps: { id: 1 }, wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.summary).toEqual(summary));

    rerender({ id: 2 });
    // The previous task's diff must not linger while the new task's summary loads.
    expect(result.current.summary).toBeNull();

    await act(async () => {
      second.resolve(summary2);
    });
    await waitFor(() => expect(result.current.summary).toEqual(summary2));
  });
});
