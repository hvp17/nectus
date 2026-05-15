import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";
import { TaskCard } from "./TaskCard";
import { TooltipProvider } from "./ui/tooltip";

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

function renderTaskCard(attention?: TaskAttention) {
  return render(
    <TooltipProvider>
      <TaskCard
        task={task}
        attention={attention}
        isSelected={false}
        busy={false}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDragStart={vi.fn()}
        onPointerDragMove={vi.fn()}
        onPointerDragEnd={vi.fn()}
        onDragEnd={vi.fn()}
      />
    </TooltipProvider>,
  );
}

describe("TaskCard", () => {
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
});
