import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskStatus, TaskSummary } from "../types";
import { RunningAgentsFlyout } from "./RunningAgentsFlyout";

const repos: Repo[] = [
  { id: 7, name: "web", path: "/repos/web", defaultWorktreeRoot: "~/.nectus/worktrees/web", createdAt: "2026-01-01T00:00:00.000Z" },
];

function makeTask(overrides: Partial<TaskSummary> & { id: number; title: string }): TaskSummary {
  return {
    repoId: 7,
    taskRepos: [],
    prompt: null,
    status: "in_progress" as TaskStatus,
    prUrl: null,
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: "feat/x",
    worktreePath: "/tmp/x",
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: "2026-06-06T00:00:00.000Z",
    updatedAt: "2026-06-06T00:00:00.000Z",
    ...overrides,
  };
}

const runningTask = makeTask({ id: 1, title: "Running task", activeSessionId: "s-1" });
const needsYouTask = makeTask({ id: 2, title: "Needs you task" });
const reviewTask = makeTask({ id: 3, title: "Review task", status: "review" });
const doneTask = makeTask({ id: 4, title: "Done task", status: "done" });
const idleTask = makeTask({ id: 5, title: "Idle task" });

const attention: TaskAttention[] = [
  { taskId: 2, kind: "needs_input", title: "Needs you task", agentName: "Codex", reason: "approval", prompt: "Apply this patch?", updatedAt: "2026-06-06T00:01:00.000Z" },
];

function renderFlyout(props?: {
  tasks?: TaskSummary[];
  attention?: TaskAttention[];
  liveLines?: Record<number, string>;
  onOpenTask?: (id: number) => void;
}) {
  return renderWithTooltipProvider(
    <RunningAgentsFlyout
      tasks={props?.tasks ?? [runningTask, needsYouTask, reviewTask, doneTask, idleTask]}
      repos={repos}
      taskAttention={props?.attention ?? attention}
      liveLines={props?.liveLines ?? {}}
      onOpenTask={props?.onOpenTask ?? vi.fn()}
    />,
  );
}

function trigger() {
  return screen.getByRole("button", { name: /running agents/i });
}

describe("RunningAgentsFlyout", () => {
  it("badges the count of in-flight agents (running + needs-you + review)", () => {
    renderFlyout();
    expect(trigger()).toHaveTextContent("3");
  });

  it("lists only the in-flight agents, excluding done and idle", () => {
    renderFlyout();
    fireEvent.click(trigger());

    expect(screen.getByText("Running task")).toBeInTheDocument();
    expect(screen.getByText("Needs you task")).toBeInTheDocument();
    expect(screen.getByText("Review task")).toBeInTheDocument();
    expect(screen.queryByText("Done task")).not.toBeInTheDocument();
    expect(screen.queryByText("Idle task")).not.toBeInTheDocument();
  });

  it("focuses a task when its row is clicked", () => {
    const onOpenTask = vi.fn();
    renderFlyout({ onOpenTask });
    fireEvent.click(trigger());

    fireEvent.click(screen.getByText("Running task"));
    expect(onOpenTask).toHaveBeenCalledWith(1);
  });

  it("shows the live activity line for a running agent", () => {
    renderFlyout({ liveLines: { 1: "Editing RunningAgentsFlyout.tsx" } });
    fireEvent.click(trigger());

    expect(screen.getByText("Editing RunningAgentsFlyout.tsx")).toBeInTheDocument();
  });

  it("quotes the needs-you prompt", () => {
    renderFlyout();
    fireEvent.click(trigger());

    expect(screen.getByText("“Apply this patch?”")).toBeInTheDocument();
  });

  it("shows an empty state and no badge when nothing is in flight", () => {
    renderFlyout({ tasks: [doneTask, idleTask], attention: [] });

    expect(trigger()).not.toHaveTextContent(/\d/);
    fireEvent.click(trigger());
    expect(screen.getByText("No agents running right now.")).toBeInTheDocument();
  });

  // Guards the asChild composition: Tooltip + Popover both render `asChild`, so the
  // single rail <button> must NOT be wrapped in another button (which would be
  // invalid HTML). When closed, the trigger is the only button on screen.
  it("renders exactly one (non-nested) trigger button when closed", () => {
    renderFlyout();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("closes the popover after a row is focused", () => {
    renderFlyout();
    fireEvent.click(trigger());
    expect(screen.getByRole("region", { name: "Running agents" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Running task"));
    expect(screen.queryByRole("region", { name: "Running agents" })).not.toBeInTheDocument();
    expect(screen.queryByText("Running task")).not.toBeInTheDocument();
  });

  it("orders groups most-urgent first regardless of input order", () => {
    // Deliberately scrambled input: review, running, needs-you.
    renderFlyout({ tasks: [reviewTask, runningTask, needsYouTask] });
    fireEvent.click(trigger());

    const titles = Array.from(document.querySelectorAll(".nx-fly-row-title")).map(
      (node) => node.textContent,
    );
    expect(titles).toEqual(["Needs you task", "Running task", "Review task"]);
  });

  it("renders a header and per-state count for each present group", () => {
    renderFlyout();
    fireEvent.click(trigger());

    for (const label of ["Needs you", "Running", "Review"]) {
      const header = screen.getByText(label).closest(".nx-fly-gl");
      expect(header).not.toBeNull();
      expect(within(header as HTMLElement).getByText("1")).toBeInTheDocument();
    }
  });

  it("falls back to a 'project' label when the repo is unknown", () => {
    renderFlyout({
      tasks: [makeTask({ id: 9, title: "Orphan task", repoId: 999, activeSessionId: "s-9" })],
      attention: [],
    });
    fireEvent.click(trigger());

    expect(screen.getByText("project")).toBeInTheDocument();
  });

  it("omits branch info for a non-worktree task", () => {
    renderFlyout({
      tasks: [makeTask({ id: 9, title: "Direct task", hasWorktree: false, activeSessionId: "s-9" })],
      attention: [],
    });
    fireEvent.click(trigger());

    expect(screen.queryByText("feat/x")).not.toBeInTheDocument();
  });

  it("shows the live pulse dot only on running rows", () => {
    renderFlyout();
    fireEvent.click(trigger());

    const runningRow = screen.getByText("Running task").closest(".nx-fly-row");
    const needsRow = screen.getByText("Needs you task").closest(".nx-fly-row");
    expect(runningRow?.querySelector(".nx-livedot")).not.toBeNull();
    expect(needsRow?.querySelector(".nx-livedot")).toBeNull();
  });
});
