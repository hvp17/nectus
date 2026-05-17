import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { TaskAttention } from "../sessionAttention";
import { appTask } from "../test/appFixtures";
import { renderWithTooltipProvider } from "../test/testUtils";
import { TaskQuickAccessPanel } from "./TaskQuickAccessPanel";

const activeTask = appTask({
  id: 31,
  title: "Wire running session",
  status: "in_progress",
  activeSessionId: "session-31",
  hasWorktree: true,
  branchName: "feat/running-session",
});

const inactiveTask = appTask({
  id: 32,
  title: "Parked task",
  activeSessionId: null,
});

function renderPanel(input?: {
  attention?: TaskAttention[];
  onOpenTask?: (taskId: number) => void;
  onStopSession?: (sessionId: string) => void;
}) {
  return renderWithTooltipProvider(
    <TaskQuickAccessPanel
      tasks={[activeTask, inactiveTask]}
      taskAttention={input?.attention ?? []}
      selectedTaskId={undefined}
      onOpenTask={input?.onOpenTask ?? vi.fn()}
      onStopSession={input?.onStopSession ?? vi.fn()}
    />,
  );
}

it("shows only tasks with active sessions and their live status context", () => {
  renderPanel({
    attention: [
      {
        taskId: activeTask.id,
        kind: "needs_input",
        title: activeTask.title,
        agentName: "Codex",
        reason: "user_confirmation",
        prompt: "Approve the migration?",
        updatedAt: "2026-05-17T12:00:00.000Z",
      },
    ],
  });

  const panel = screen.getByRole("region", { name: /tasks quick access/i });

  expect(within(panel).getByText("Wire running session")).toBeInTheDocument();
  expect(within(panel).queryByText("Parked task")).not.toBeInTheDocument();
  expect(within(panel).getByText("Needs input")).toBeInTheDocument();
  expect(within(panel).getByText("User Confirmation")).toBeInTheDocument();
  expect(within(panel).getByText("In progress")).toBeInTheDocument();
  expect(within(panel).queryByText("Codex")).not.toBeInTheDocument();
  expect(within(panel).queryByText("feat/running-session")).not.toBeInTheDocument();
  expect(within(panel).getByLabelText("Worktree: feat/running-session")).toBeInTheDocument();
});

it("opens and stops active sessions from the quick access panel", () => {
  const onOpenTask = vi.fn();
  const onStopSession = vi.fn();

  renderPanel({ onOpenTask, onStopSession });

  fireEvent.click(screen.getByRole("button", { name: /open wire running session/i }));
  expect(onOpenTask).toHaveBeenCalledWith(activeTask.id);

  fireEvent.click(screen.getByRole("button", { name: /stop wire running session/i }));
  expect(onStopSession).toHaveBeenCalledWith("session-31");
});
