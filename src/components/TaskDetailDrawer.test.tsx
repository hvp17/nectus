import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import type { AgentProfile, ReviewLoop, ReviewRun, TaskSummary } from "../types";
import { TaskDetailDrawer } from "./TaskDetailDrawer";

const task: TaskSummary = {
  id: 42,
  repoId: 7,
  title: "Finished task with long output",
  prompt: "Check the final agent output.",
  status: "done",
  prUrl: null,
  agentProfileId: 1,
  agentName: "Codex",
  agentKind: "codex",
  hasWorktree: true,
  branchName: "feat/card-ellipsis",
  worktreePath: "/tmp/nectus-worktrees/feat-card-ellipsis",
  isDirty: false,
  activeSessionId: null,
  lastSessionId: null,
  lastSessionAgent: null,
  lastSessionCwd: null,
  lastSessionLabel: null,
  createdAt: "2026-05-15T00:00:00.000Z",
  updatedAt: "2026-05-15T00:00:00.000Z",
};

const agentProfiles: AgentProfile[] = [
  {
    id: 1,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Claude Review",
    agentKind: "claude",
    command: "claude",
    model: null,
    args: ["--print"],
    env: {},
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
  },
];

function dispatchPointerEvent(
  target: Element | Window,
  type: string,
  init: { pointerId: number; button?: number; clientY: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId },
    button: { value: init.button ?? 0 },
    clientY: { value: init.clientY },
  });
  fireEvent(target, event);
}

function renderTaskDetailDrawer(input?: {
  task?: TaskSummary;
  attention?: TaskAttention;
  reviewLoop?: ReviewLoop | null;
  reviewRuns?: ReviewRun[];
  onStartPairLoop?: (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => void;
  onStartReview?: (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => void;
  onUpdateStatus?: (task: TaskSummary, status: TaskSummary["status"]) => void;
}) {
  return render(
    <TaskDetailDrawer
      task={input?.task ?? task}
      attention={input?.attention}
      agentProfiles={agentProfiles}
      reviewLoop={input?.reviewLoop ?? null}
      reviewRuns={input?.reviewRuns ?? []}
      isExpanded={false}
      onClose={vi.fn()}
      onToggleExpanded={vi.fn()}
      onStopSession={vi.fn()}
      onResumeSession={vi.fn()}
      onStartSession={vi.fn()}
      onStartPairLoop={input?.onStartPairLoop ?? vi.fn()}
      onStartReview={input?.onStartReview ?? vi.fn()}
      onStopPairLoop={vi.fn()}
      onUpdateStatus={input?.onUpdateStatus ?? vi.fn()}
      onSessionExit={vi.fn()}
      onSessionInput={vi.fn()}
    />,
  );
}

describe("TaskDetailDrawer", () => {
  it("truncates long finished attention content in the sidebar panel", () => {
    const message = "A".repeat(220);

    renderTaskDetailDrawer({
      attention: {
        taskId: task.id,
        kind: "idle",
        title: task.title,
        agentName: task.agentName,
        message,
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    const truncated = `${"A".repeat(180)}...`;
    const detail = screen.getByText(truncated);

    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(detail).toHaveAttribute("title", message);
  });

  it("starts a pair loop with the selected reviewer", () => {
    const onStartPairLoop = vi.fn();

    renderTaskDetailDrawer({ onStartPairLoop });

    screen.getByRole("button", { name: /start pair loop/i }).click();

    expect(onStartPairLoop).toHaveBeenCalledWith(task, 2, 3);
  });

  it("starts an immediate review from the workflow stepper", () => {
    const onStartReview = vi.fn();

    renderTaskDetailDrawer({ onStartReview });

    screen.getByRole("tab", { name: /start review/i }).click();

    expect(onStartReview).toHaveBeenCalledWith(task, 2, 3);
  });

  it("runs task workflow actions from the sidebar stepper", () => {
    const onStartReview = vi.fn();
    const onUpdateStatus = vi.fn();
    const inReviewTask: TaskSummary = { ...task, status: "review" };

    renderTaskDetailDrawer({ task: inReviewTask, onStartReview, onUpdateStatus });

    screen.getByRole("tab", { name: /start review/i }).click();
    expect(onStartReview).toHaveBeenCalledWith(inReviewTask, 2, 3);

    expect(screen.getByRole("tab", { name: /create pr/i })).toBeDisabled();

    screen.getByRole("tab", { name: /move to done/i }).click();
    expect(onUpdateStatus).toHaveBeenCalledWith(inReviewTask, "done");
  });

  it("shows review progress in the workflow stepper", () => {
    renderTaskDetailDrawer({
      task: { ...task, status: "review" },
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        maxRounds: 3,
        currentRound: 0,
        status: "reviewing",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:01:00.000Z",
      },
    });

    const reviewButton = screen.getByRole("tab", { name: /reviewing/i });

    expect(reviewButton).toBeDisabled();
  });

  it("shows review loop status and latest review output", () => {
    renderTaskDetailDrawer({
      reviewLoop: {
        taskId: task.id,
        reviewerProfileId: 2,
        maxRounds: 3,
        currentRound: 1,
        status: "running",
        lastError: null,
        createdAt: "2026-05-15T00:00:00.000Z",
        updatedAt: "2026-05-15T00:02:00.000Z",
      },
      reviewRuns: [
        {
          id: 10,
          taskId: task.id,
          round: 1,
          reviewerProfileId: 2,
          verdict: "feedback",
          prompt: "Review the worktree",
          output: "NECTUS_FEEDBACK\nConsider moving this into a smaller helper.",
          error: null,
          createdAt: "2026-05-15T00:01:00.000Z",
        },
      ],
    });

    expect(screen.getByText(/round 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/consider moving this into a smaller helper/i)).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  it("lets the terminal panel expand vertically from the resize separator", () => {
    renderTaskDetailDrawer();

    const inspectorBody = screen.getByTestId("task-detail-body");
    vi.spyOn(inspectorBody, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 480,
      height: 800,
      top: 0,
      right: 480,
      bottom: 800,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const separator = screen.getByRole("separator", { name: /resize terminal/i });
    const terminalPanel = screen.getByRole("region", { name: /agent terminal/i });

    expect(terminalPanel).toHaveStyle({ height: "360px" });

    separator.focus();
    fireEvent.keyDown(separator, { key: "ArrowUp" });

    expect(terminalPanel).toHaveStyle({ height: "392px" });

    dispatchPointerEvent(separator, "pointerdown", { pointerId: 1, button: 0, clientY: 430 });
    dispatchPointerEvent(window, "pointermove", { pointerId: 1, clientY: 300 });
    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientY: 300 });

    expect(terminalPanel).toHaveStyle({ height: "500px" });
    expect(separator).toHaveAttribute("aria-valuenow", "500");
  });
});
