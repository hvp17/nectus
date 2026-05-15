import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";
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

function renderTaskDetailDrawer(attention?: TaskAttention) {
  return render(
    <TaskDetailDrawer
      task={task}
      attention={attention}
      isExpanded={false}
      onClose={vi.fn()}
      onToggleExpanded={vi.fn()}
      onStopSession={vi.fn()}
      onResumeSession={vi.fn()}
      onStartSession={vi.fn()}
      onUpdateStatus={vi.fn()}
      onSessionExit={vi.fn()}
      onSessionInput={vi.fn()}
    />,
  );
}

describe("TaskDetailDrawer", () => {
  it("truncates long finished attention content in the sidebar panel", () => {
    const message = "A".repeat(220);

    renderTaskDetailDrawer({
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
