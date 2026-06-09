import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventBridge } from "./useEventBridge";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { api } from "../api";
import { upsertTaskAttention } from "../sessionAttention";
import type { PrReview, ReviewLoop, ReviewRun, SessionNeedsInputEvent, TaskSummary } from "../types";

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
vi.mock("../api", () => ({ api: { listTasks: vi.fn().mockResolvedValue([]) } }));

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
  await waitFor(() => expect(listeners.has("session_exited")).toBe(true));
  return queryClient;
}

const liveLines = () => useAppStore.getState().liveLines;
const taskAttention = () => useAppStore.getState().taskAttention;

describe("useEventBridge", () => {
  beforeEach(() => {
    listeners.clear();
    listenMock.mockClear();
    useAppStore.setState({ liveLines: {}, message: null, taskAttention: [], taskToast: null });
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("records the live activity line for a task", async () => {
    await mountBridge([baseTask]);

    act(() => {
      listeners.get("session_activity")?.({ payload: { sessionId: "s-1", taskId: 7, line: "Running tests" } });
    });

    expect(liveLines()).toEqual({ 7: "Running tests" });
  });

  it("clears the live line and attention when its session exits", async () => {
    useAppStore.setState({ taskAttention: upsertTaskAttention([], baseTask, idleNeedsInput) });
    await mountBridge([baseTask]);

    act(() => {
      listeners.get("session_activity")?.({ payload: { sessionId: "s-1", taskId: 7, line: "Running tests" } });
    });
    expect(liveLines()).toEqual({ 7: "Running tests" });
    expect(taskAttention()).toHaveLength(1);

    act(() => {
      listeners.get("session_exited")?.({ payload: { sessionId: "s-1" } });
    });

    expect(liveLines()).toEqual({});
    expect(taskAttention()).toEqual([]);
  });

  it("records attention on session_idle for a known task", async () => {
    await mountBridge([baseTask]);

    act(() => {
      listeners.get("session_idle")?.({ payload: { sessionId: "s-1", taskId: 7, turnId: null, message: "Done" } });
    });

    expect(taskAttention()).toHaveLength(1);
    expect(taskAttention()[0].taskId).toBe(7);
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
    const error = new Error("session_idle failed");
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
    await waitFor(() => expect(listeners.has("session_activity")).toBe(true));
  });
});

const idleNeedsInput: SessionNeedsInputEvent = {
  sessionId: "s-1",
  taskId: 7,
  turnId: null,
  reason: "permission",
  prompt: "Approve?",
};
