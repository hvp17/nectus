import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import { dispatchPointerEvent, renderWithTooltipProvider } from "../test/testUtils";
import type { TaskSummary } from "../types";
import { TaskCard } from "./TaskCard";

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

function renderTaskCard(attention?: TaskAttention, taskOverride: Partial<TaskSummary> = {}) {
  return renderWithTooltipProvider(
    <TaskCard
      task={{ ...task, ...taskOverride }}
      attention={attention}
      isSelected={false}
      busy={false}
      onSelect={vi.fn()}
      onDelete={vi.fn()}
      onDragStart={vi.fn()}
      onPointerDragMove={vi.fn()}
      onPointerDragEnd={vi.fn()}
      onDragEnd={vi.fn()}
    />,
  );
}

describe("TaskCard", () => {
  afterEach(() => {
    document.body.classList.remove("task-drag-selection-lock");
  });

  it("truncates long finished-card content", () => {
    const message = "A".repeat(220);

    renderTaskCard({
      taskId: task.id,
      kind: "idle",
      title: task.title,
      agentName: task.agentName,
      message,
      updatedAt: "2026-05-15T00:01:00.000Z",
    });

    const truncated = `${"A".repeat(180)}...`;
    const detail = screen.getByText(truncated);

    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(detail).toHaveAttribute("title", message);
  });

  it("shows completed review status on the card", () => {
    renderTaskCard(undefined, {
      reviewLoopStatus: "passed",
    });

    expect(screen.getByText("Review passed")).toBeInTheDocument();
    expect(screen.queryByText(/round/i)).not.toBeInTheDocument();
  });

  it("warns that worktree task deletion removes the worktree from disk", async () => {
    renderTaskCard();

    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));

    expect(await screen.findByText("Delete task?")).toBeInTheDocument();
    expect(
      screen.getByText(`This removes "${task.title}" and its worktree from Nectus and disk.`),
    ).toBeInTheDocument();
  });

  it("locks page text selection while tracking a pointer drag", () => {
    renderTaskCard();

    const card = screen.getByRole("button", { name: /finished task with long output/i });

    dispatchPointerEvent(card, "pointerdown", { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    expect(document.body).toHaveClass("task-drag-selection-lock");

    const moveEvent = dispatchPointerEvent(window, "pointermove", {
      pointerId: 1,
      clientX: 11,
      clientY: 10,
    });

    expect(moveEvent.defaultPrevented).toBe(true);

    dispatchPointerEvent(window, "pointerup", { pointerId: 1, clientX: 11, clientY: 10 });
    expect(document.body).not.toHaveClass("task-drag-selection-lock");
  });
});
