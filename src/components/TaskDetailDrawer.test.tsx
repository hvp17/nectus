import { render, screen } from "@testing-library/react";
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

function renderTaskDetailDrawer(input?: {
  attention?: TaskAttention;
  reviewLoop?: ReviewLoop | null;
  reviewRuns?: ReviewRun[];
  onStartPairLoop?: (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => void;
}) {
  return render(
    <TaskDetailDrawer
      task={task}
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
      onStopPairLoop={vi.fn()}
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
          verdict: "needs_changes",
          prompt: "Review the worktree",
          output: "Blocking issue: missing persistence test",
          error: null,
          createdAt: "2026-05-15T00:01:00.000Z",
        },
      ],
    });

    expect(screen.getByText(/round 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/blocking issue: missing persistence test/i)).toBeInTheDocument();
  });
});
