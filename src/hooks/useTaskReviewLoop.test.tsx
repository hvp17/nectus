import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import type { ReviewLoop, ReviewLoopUpdatedEvent, ReviewRun } from "../types";
import { useTaskReviewLoop } from "./useTaskReviewLoop";

/** Render under a fresh QueryClient (the hook now reads through the query cache). */
function renderWithClient(ui: ReactNode) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>);
}

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
    getTaskReviewLoop: vi.fn(),
    listTaskReviewRuns: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const reviewLoop: ReviewLoop = {
  taskId: 21,
  reviewerProfileId: 2,
  status: "running",
  lastError: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:01:00.000Z",
};

const firstRun: ReviewRun = {
  id: 1,
  taskId: 21,
  reviewerProfileId: 2,
  verdict: "needs_changes",
  prompt: "Review this task",
  output: "Needs changes",
  error: null,
  createdAt: "2026-05-15T00:01:00.000Z",
};

function Harness({
  selectedTaskId,
  onReviewLoopUpdated,
}: {
  selectedTaskId?: number;
  onReviewLoopUpdated?: (reviewLoop: ReviewLoop) => void;
}) {
  const { selectedReviewLoop, selectedReviewRuns, message } = useTaskReviewLoop({
    selectedTaskId,
    onReviewLoopUpdated,
  });

  return (
    <>
      <output data-testid="status">{selectedReviewLoop?.status ?? "none"}</output>
      <output data-testid="runs">{selectedReviewRuns.length}</output>
      <output data-testid="message">{message ?? ""}</output>
    </>
  );
}

describe("useTaskReviewLoop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventTestState.handlers.clear();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    mockedApi.getTaskReviewLoop.mockResolvedValue(reviewLoop);
    mockedApi.listTaskReviewRuns.mockResolvedValue([firstRun]);
  });

  it("loads the selected task review loop and review runs", async () => {
    renderWithClient(<Harness selectedTaskId={21} />);

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("running");
    });
    expect(screen.getByTestId("runs")).toHaveTextContent("1");
    expect(mockedApi.getTaskReviewLoop).toHaveBeenCalledWith(21);
    expect(mockedApi.listTaskReviewRuns).toHaveBeenCalledWith(21);
  });

  it("resets review state without a selected task", () => {
    renderWithClient(<Harness selectedTaskId={undefined} />);

    expect(screen.getByTestId("status")).toHaveTextContent("none");
    expect(screen.getByTestId("runs")).toHaveTextContent("0");
    expect(mockedApi.getTaskReviewLoop).not.toHaveBeenCalled();
    expect(mockedApi.listTaskReviewRuns).not.toHaveBeenCalled();
  });

  it("applies review loop events for the selected task only", async () => {
    renderWithClient(<Harness selectedTaskId={21} />);

    await waitFor(() => {
      expect(eventTestState.handlers.has("review_loop_updated")).toBe(true);
    });
    // The loop/runs now load through the query cache; wait for that before firing
    // the event so the append builds on the loaded runs, not an empty cache.
    await waitFor(() => expect(screen.getByTestId("runs")).toHaveTextContent("1"));

    const nextRun: ReviewRun = {
      ...firstRun,
      id: 2,
      output: "Passed",
      verdict: "pass",
      createdAt: "2026-05-15T00:02:00.000Z",
    };

    act(() => {
      eventTestState.handlers.get("review_loop_updated")?.({
        payload: {
          taskId: 21,
          reviewLoop: { ...reviewLoop, status: "passed" },
          reviewRun: nextRun,
        } satisfies ReviewLoopUpdatedEvent,
      });
    });

    // The handler writes the cache; the observer update propagates via Query's
    // microtask scheduler, so assert with waitFor rather than synchronously.
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("passed");
      expect(screen.getByTestId("runs")).toHaveTextContent("2");
    });

    act(() => {
      eventTestState.handlers.get("review_loop_updated")?.({
        payload: {
          taskId: 99,
          reviewLoop: { ...reviewLoop, taskId: 99, status: "error" },
          reviewRun: null,
        } satisfies ReviewLoopUpdatedEvent,
      });
    });

    // An event for another task must not touch the selected task's cache.
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("passed"));
  });

  it("publishes review loop events for task-board summaries even when another task is selected", async () => {
    const onReviewLoopUpdated = vi.fn();
    renderWithClient(<Harness selectedTaskId={21} onReviewLoopUpdated={onReviewLoopUpdated} />);

    await waitFor(() => {
      expect(eventTestState.handlers.has("review_loop_updated")).toBe(true);
    });
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("running"));

    act(() => {
      eventTestState.handlers.get("review_loop_updated")?.({
        payload: {
          taskId: 99,
          reviewLoop: { ...reviewLoop, taskId: 99, status: "passed" },
          reviewRun: null,
        } satisfies ReviewLoopUpdatedEvent,
      });
    });

    expect(onReviewLoopUpdated).toHaveBeenCalledWith({
      ...reviewLoop,
      taskId: 99,
      status: "passed",
    });
    expect(screen.getByTestId("status")).toHaveTextContent("running");
  });
});
