import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventBridge } from "./useEventBridge";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { api } from "../api";
import type { PrReview, ReviewLoop, ReviewRun, TaskSummary } from "../types";

// Capture the handlers the bridge registers so tests can fire events without a
// Tauri backend.
const { listeners, listenMock } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  const listenMock = vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  });
  return { listeners, listenMock };
});

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("../api", () => ({
  api: { listTasks: vi.fn().mockResolvedValue([]), sendSystemNotification: vi.fn().mockResolvedValue(true) },
}));

const baseTask: TaskSummary = {
  id: 7,
  repoId: 1,
  taskRepos: [],
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
  archived: false,
  activeSessionId: "s-1",
  lastSessionId: "s-1",
  lastSessionAgent: "codex",
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

async function mountBridge(tasks: TaskSummary[]) {
  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.tasks(), tasks);
  vi.mocked(api.listTasks).mockResolvedValue(tasks);
  renderHook(() => useEventBridge(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  await waitFor(() => expect(listeners.has("session_chat")).toBe(true));
  return queryClient;
}

const liveLines = () => useAppStore.getState().liveLines;

describe("useEventBridge", () => {
  beforeEach(() => {
    listeners.clear();
    listenMock.mockClear();
    vi.mocked(api.sendSystemNotification).mockClear();
    useAppStore.setState({
      liveLines: {},
      message: null,
      taskAttention: [],
      taskToast: null,
      chatWorkingTaskIds: {},
      selectedTaskId: undefined,
    });
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("mirrors ACP chat streaming into liveLines and chatWorkingTaskIds", async () => {
    const queryClient = await mountBridge([{ ...baseTask, activeSessionId: null }]);

    act(() => {
      listeners.get("session_chat")?.({
        payload: {
          sessionId: "chat-1",
          taskId: 7,
          agentProfileId: 1,
          done: false,
          message: {
            id: "agent-1",
            role: "agent",
            parts: [{ type: "tool", toolCallId: "t1", title: "Read src/lib.rs", status: "running", locations: [] }],
            createdAt: "2026-06-15T00:00:00.000Z",
            completedAt: null,
          },
        },
      });
    });

    await waitFor(() => expect(liveLines()).toEqual({ 7: "Read src/lib.rs" }));
    expect(useAppStore.getState().chatWorkingTaskIds).toEqual({ 7: true });

    act(() => {
      listeners.get("session_chat")?.({
        payload: {
          sessionId: "chat-1",
          taskId: 7,
          agentProfileId: 1,
          done: true,
          message: {
            id: "agent-1",
            role: "agent",
            parts: [{ type: "text", text: "Done editing." }],
            createdAt: "2026-06-15T00:00:00.000Z",
            completedAt: "2026-06-15T00:01:00.000Z",
          },
        },
      });
    });

    await waitFor(() => expect(useAppStore.getState().chatWorkingTaskIds).toEqual({}));
    expect(queryClient.getQueryData<import("../types").ChatTranscript>(queryKeys.task.chat(7, 1))?.messages).toHaveLength(1);
  });

  function fireTurnComplete(taskId: number) {
    listeners.get("session_chat")?.({
      payload: {
        sessionId: "chat-1",
        taskId,
        agentProfileId: 1,
        done: true,
        message: {
          id: "agent-1",
          role: "agent",
          parts: [{ type: "text", text: "All done." }],
          createdAt: "2026-06-18T00:00:00.000Z",
          completedAt: "2026-06-18T00:01:00.000Z",
        },
      },
    });
  }

  it("fires a finish toast and OS notification when an unfocused agent turn completes", async () => {
    await mountBridge([{ ...baseTask, activeSessionId: null }]);

    act(() => fireTurnComplete(7));

    await waitFor(() => expect(useAppStore.getState().taskToast?.taskId).toBe(7));
    expect(useAppStore.getState().taskToast).toMatchObject({ kind: "success", agentKind: "codex" });
    expect(api.sendSystemNotification).toHaveBeenCalledTimes(1);
  });

  it("suppresses the finish toast and notification for the task you're viewing", async () => {
    useAppStore.setState({ selectedTaskId: 7 });
    await mountBridge([{ ...baseTask, activeSessionId: null }]);

    act(() => fireTurnComplete(7));

    await waitFor(() => expect(useAppStore.getState().chatWorkingTaskIds).toEqual({}));
    expect(useAppStore.getState().taskToast).toBeNull();
    expect(api.sendSystemNotification).not.toHaveBeenCalled();
  });

  it("clears chat runtime when chat_session_exited fires", async () => {
    useAppStore.setState({ liveLines: { 7: "Working" }, chatWorkingTaskIds: { 7: true } });
    await mountBridge([baseTask]);

    act(() => {
      listeners.get("chat_session_exited")?.({
        payload: { sessionId: "chat-1", taskId: 7, agentProfileId: 1 },
      });
    });

    expect(liveLines()).toEqual({});
    expect(useAppStore.getState().chatWorkingTaskIds).toEqual({});
  });

  it("routes ACP session runtime metadata into the chat transcript cache", async () => {
    const queryClient = await mountBridge([baseTask]);
    await waitFor(() => expect(listeners.has("session_chat_runtime")).toBe(true));

    act(() => {
      listeners.get("session_chat_runtime")?.({
        payload: {
          sessionId: "chat-1",
          taskId: 7,
          agentProfileId: 1,
          runtime: {
            capabilities: {
              loadSession: true,
              prompt: { image: false, audio: false, embeddedContext: true },
              mcp: { http: false, sse: false },
            },
            agentInfo: { name: "codex", title: "Codex", version: "1.0.0" },
            authMethods: [],
            availableCommands: [{ name: "plan", description: "Create a plan", inputHint: null }],
            modes: [{ id: "code", name: "Code", description: null }],
            currentModeId: "code",
            configOptions: [],
            title: "Implement ACP polish",
            updatedAt: "2026-06-15T00:00:00.000Z",
          },
        },
      });
    });

    const transcript = queryClient.getQueryData<import("../types").ChatTranscript>(
      queryKeys.task.chat(7, 1),
    );
    expect(transcript?.session?.runtime?.title).toBe("Implement ACP polish");
    expect(transcript?.session?.runtime?.capabilities.prompt.image).toBe(false);
  });

  it("marks a task done when its review loop passes", async () => {
    const queryClient = await mountBridge([baseTask]);
    const reviewLoop: ReviewLoop = {
      taskId: 7,
      reviewerProfileId: 1,
      status: "passed",
      lastError: null,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:01:00.000Z",
    };

    act(() => {
      listeners.get("review_loop_updated")?.({ payload: { taskId: 7, reviewLoop, reviewRun: null } });
    });

    const tasks = queryClient.getQueryData<TaskSummary[]>(queryKeys.tasks());
    expect(tasks?.[0].status).toBe("done");
    expect(queryClient.getQueryData(queryKeys.task.reviewLoop(7))).toEqual(reviewLoop);
  });

  it("deduplicates repeated review loop run events by run id", async () => {
    const queryClient = await mountBridge([baseTask]);
    const reviewLoop: ReviewLoop = {
      taskId: 7,
      reviewerProfileId: 1,
      status: "reviewing",
      lastError: null,
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:01:00.000Z",
    };
    const reviewRun: ReviewRun = {
      id: 21,
      taskId: 7,
      reviewerProfileId: 1,
      verdict: "needs_changes",
      prompt: "Review this task",
      output: "Needs changes",
      error: null,
      createdAt: "2026-05-15T00:01:00.000Z",
    };

    act(() => {
      listeners.get("review_loop_updated")?.({ payload: { taskId: 7, reviewLoop, reviewRun } });
      listeners.get("review_loop_updated")?.({ payload: { taskId: 7, reviewLoop, reviewRun } });
    });

    const runs = queryClient.getQueryData<ReviewRun[]>(queryKeys.task.reviewRuns(7));
    expect(runs?.map((run) => run.id)).toEqual([21]);
  });

  it("upserts a PR review into the list cache on pr_review_updated", async () => {
    const queryClient = await mountBridge([baseTask]);
    const review = { id: 9, prNumber: 9, prTitle: "Add caching", status: "ready", lastError: null } as PrReview;

    act(() => {
      listeners.get("pr_review_updated")?.({ payload: { prReview: review, latestRun: null } });
    });

    const reviews = queryClient.getQueryData<PrReview[]>(queryKeys.prReviews.list());
    expect(reviews?.[0].id).toBe(9);
  });

  it("keeps registering later event channels when one subscription fails", async () => {
    const error = new Error("review_loop_updated failed");
    listenMock.mockRejectedValueOnce(error);
    const queryClient = createQueryClient();
    queryClient.setQueryData(queryKeys.tasks(), [baseTask]);
    vi.mocked(api.listTasks).mockResolvedValue([baseTask]);

    renderHook(() => useEventBridge(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(useAppStore.getState().message).toBe(String(error)));
    await waitFor(() => expect(listeners.has("session_chat")).toBe(true));
  });
});
