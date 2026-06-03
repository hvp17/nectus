import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { SidebarProvider } from "./ui/sidebar";
import type { TaskAttention } from "../sessionAttention";
import { appRepo, appTask } from "../test/appFixtures";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { Repo, TaskSummary } from "../types";

const otherRepo: Repo = {
  id: 8,
  name: "polymarket-trader",
  path: "/tmp/polymarket-trader",
  defaultWorktreeRoot: "/tmp/polymarket-trader-worktrees",
  createdAt: "2026-05-14T00:00:00.000Z",
};

const repos = [appRepo, otherRepo];

const tasks: TaskSummary[] = [
  appTask({ id: 21, repoId: appRepo.id, title: "Planned in nectus", status: "planned" }),
  appTask({ id: 22, repoId: appRepo.id, title: "Running in nectus", activeSessionId: "session-22" }),
  appTask({ id: 23, repoId: otherRepo.id, title: "Task in trader", status: "review" }),
];

function renderSidebar(input?: {
  selectedRepoId?: number;
  taskAttention?: TaskAttention[];
  onSelectRepo?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onCreateTaskInRepo?: (repoId: number) => void;
  onStopSession?: (sessionId: string) => void;
}) {
  const props = {
    onSelectRepo: input?.onSelectRepo ?? vi.fn(),
    onOpenTask: input?.onOpenTask ?? vi.fn(),
    onCreateTaskInRepo: input?.onCreateTaskInRepo ?? vi.fn(),
    onStopSession: input?.onStopSession ?? vi.fn(),
  };

  renderWithTooltipProvider(
    <SidebarProvider>
      <Sidebar
        repos={repos}
        selectedRepoId={input?.selectedRepoId ?? appRepo.id}
        selectedTaskId={undefined}
        tasks={tasks}
        taskAttention={input?.taskAttention ?? []}
        onAddProject={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenReviews={vi.fn()}
        onOpenJira={vi.fn()}
        settingsActive={false}
        reviewsActive={false}
        jiraActive={false}
        busy={false}
        loading={false}
        {...props}
      />
    </SidebarProvider>,
  );

  return props;
}

it("nests a project's tasks under it and collapses other projects by default", () => {
  renderSidebar();

  expect(screen.getByRole("button", { name: /open planned in nectus/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /open running in nectus/i })).toBeInTheDocument();
  // The unselected project stays collapsed, so its tasks are not rendered.
  expect(screen.queryByRole("button", { name: /open task in trader/i })).not.toBeInTheDocument();
});

it("shows the task status for tasks without an active session", () => {
  renderSidebar();

  const plannedRow = screen.getByRole("button", { name: /open planned in nectus/i });
  expect(within(plannedRow).getByText("Planned")).toBeInTheDocument();
  // Non-active tasks must not be labelled as running.
  expect(within(plannedRow).queryByText("Running")).not.toBeInTheDocument();
});

it("expands a project on selection and collapses it again on a second click", () => {
  const onSelectRepo = vi.fn();
  renderSidebar({ onSelectRepo });

  const traderProject = screen.getByRole("button", { name: /^polymarket-trader/i });

  // First click selects the unselected project.
  fireEvent.click(traderProject);
  expect(onSelectRepo).toHaveBeenCalledWith(otherRepo.id);

  // The already-selected project toggles closed on click.
  const nectusProject = screen.getByRole("button", { name: /^nectus-desktop/i });
  expect(screen.getByRole("button", { name: /open planned in nectus/i })).toBeInTheDocument();
  fireEvent.click(nectusProject);
  expect(screen.queryByRole("button", { name: /open planned in nectus/i })).not.toBeInTheDocument();
});

it("creates a task in the project the add action belongs to", () => {
  const onCreateTaskInRepo = vi.fn();
  renderSidebar({ onCreateTaskInRepo });

  fireEvent.click(screen.getByRole("button", { name: /add task to polymarket-trader/i }));

  expect(onCreateTaskInRepo).toHaveBeenCalledWith(otherRepo.id);
});

it("stops an active session and opens tasks from nested rows", () => {
  const onOpenTask = vi.fn();
  const onStopSession = vi.fn();
  renderSidebar({ onOpenTask, onStopSession });

  fireEvent.click(screen.getByRole("button", { name: /open running in nectus/i }));
  expect(onOpenTask).toHaveBeenCalledWith(22);

  fireEvent.click(screen.getByRole("button", { name: /stop running in nectus/i }));
  expect(onStopSession).toHaveBeenCalledWith("session-22");
});

it("flags a collapsed project when one of its hidden tasks needs input", () => {
  const taskAttention: TaskAttention[] = [
    {
      taskId: 23,
      kind: "needs_input",
      title: "Task in trader",
      reason: "user_confirmation",
      updatedAt: "2026-05-17T12:00:00.000Z",
    },
  ];

  renderSidebar({ taskAttention });

  expect(screen.getByLabelText("Task needs input")).toBeInTheDocument();
});
