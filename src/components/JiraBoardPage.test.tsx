import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { JiraColumn } from "../hooks/useJira";
import type { JiraStatus, JiraWorkItem, TaskSummary } from "../types";
import { JiraBoardPage } from "./JiraBoardPage";

const status: JiraStatus = {
  installed: true,
  authenticated: true,
  account: "me@example.com",
  site: "example.atlassian.net",
};

const story: JiraWorkItem = {
  key: "SCRUM-2",
  summary: "Hi Mann this is in review",
  statusName: "To Do",
  statusCategory: "to_do",
  issueType: "Task",
  priority: "High",
  assignee: null,
  url: null,
  description: null,
};

const columns: JiraColumn[] = [{ statusName: "To Do", category: "to_do", items: [story] }];

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 1,
    repoId: 7,
    title: "Task",
    prompt: null,
    status: "in_progress",
    prUrl: null,
    agentProfileId: 1,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: false,
    branchName: null,
    worktreePath: null,
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    jiraIssueKey: null,
    jiraIssueSummary: null,
    jiraIssueUrl: null,
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    ...overrides,
  };
}

function renderBoard(tasks: TaskSummary[], onOpenTask = vi.fn()) {
  renderWithTooltipProvider(
    <JiraBoardPage
      status={status}
      projects={[{ key: "SCRUM", name: "Scrum" }]}
      tasks={tasks}
      project="SCRUM"
      filters={{ myIssues: false, unresolved: true, currentSprint: false, statuses: [] }}
      columns={columns}
      loading={false}
      onChangeConfig={vi.fn()}
      onRefresh={vi.fn()}
      onTransition={vi.fn()}
      onOpenItem={vi.fn()}
      onOpenTask={onOpenTask}
      onCreateTask={vi.fn()}
    />,
  );
  return onOpenTask;
}

function renderCreatable(
  overrides: {
    createOpen?: boolean;
    onOpenCreate?: () => void;
    onCreateWorkItem?: (input: {
      project: string;
      issueType: string;
      summary: string;
      description?: string;
      assignee?: string;
      labels?: string;
    }) => Promise<JiraWorkItem | null>;
    project?: string | null;
  } = {},
) {
  renderWithTooltipProvider(
    <JiraBoardPage
      status={status}
      projects={[{ key: "SCRUM", name: "Scrum" }]}
      tasks={[]}
      project={overrides.project === undefined ? "SCRUM" : overrides.project}
      filters={{ myIssues: false, unresolved: true, currentSprint: false, statuses: [] }}
      columns={columns}
      loading={false}
      onChangeConfig={vi.fn()}
      onRefresh={vi.fn()}
      onTransition={vi.fn()}
      onOpenItem={vi.fn()}
      onOpenTask={vi.fn()}
      onCreateTask={vi.fn()}
      createOpen={overrides.createOpen ?? false}
      onOpenCreate={overrides.onOpenCreate ?? vi.fn()}
      onCloseCreate={vi.fn()}
      onCreateWorkItem={overrides.onCreateWorkItem ?? vi.fn().mockResolvedValue(null)}
    />,
  );
}

describe("JiraBoardPage linked tasks", () => {
  it("lists only the tasks attached to a story", () => {
    renderBoard([
      task({ id: 1, title: "Attached session", jiraIssueKey: "SCRUM-2" }),
      task({ id: 2, title: "Other story", jiraIssueKey: "SCRUM-9" }),
      task({ id: 3, title: "Unlinked task", jiraIssueKey: null }),
    ]);

    expect(screen.getByText("Attached session")).toBeInTheDocument();
    expect(screen.queryByText("Other story")).not.toBeInTheDocument();
    expect(screen.queryByText("Unlinked task")).not.toBeInTheDocument();
  });

  it("opens the task when its chip is clicked", () => {
    const onOpenTask = renderBoard([task({ id: 5, title: "Open me", jiraIssueKey: "SCRUM-2" })]);

    fireEvent.click(screen.getByTitle("Open me"));

    expect(onOpenTask).toHaveBeenCalledWith(5);
  });

  it("shows a running indicator for a task with a live session", () => {
    renderBoard([
      task({ id: 6, title: "Live", jiraIssueKey: "SCRUM-2", activeSessionId: "sess-1" }),
    ]);

    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("renders the issue key and priority on the card like a JIRA card", () => {
    renderBoard([]);

    expect(screen.getByText("SCRUM-2")).toBeInTheDocument();
    expect(screen.getByTitle("Priority: High")).toBeInTheDocument();
  });
});

describe("JiraBoardPage create work item", () => {
  it("opens the create panel from the toolbar button", () => {
    const onOpenCreate = vi.fn();
    renderCreatable({ onOpenCreate });

    fireEvent.click(screen.getByRole("button", { name: "New work item" }));

    expect(onOpenCreate).toHaveBeenCalledTimes(1);
  });

  it("disables the New work item button until a project is chosen", () => {
    renderCreatable({ project: null });

    expect(screen.getByRole("button", { name: "New work item" })).toBeDisabled();
  });

  it("docks the create form and submits the entered fields with board defaults", () => {
    const onCreateWorkItem = vi.fn().mockResolvedValue(null);
    renderCreatable({ createOpen: true, onCreateWorkItem });

    expect(screen.getByTestId("jira-create-panel")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Summary"), {
      target: { value: "Investigate flaky login" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create work item/i }));

    expect(onCreateWorkItem).toHaveBeenCalledWith({
      project: "SCRUM",
      issueType: "Task",
      summary: "Investigate flaky login",
      description: undefined,
      assignee: undefined,
      labels: undefined,
    });
  });

  it("keeps the submit button disabled until a summary is entered", () => {
    renderCreatable({ createOpen: true });

    expect(screen.getByRole("button", { name: /create work item/i })).toBeDisabled();
  });
});

describe("JiraBoardPage status filter", () => {
  it("offers the filterable statuses and persists a toggled selection", async () => {
    const onChangeConfig = vi.fn();
    renderWithTooltipProvider(
      <JiraBoardPage
        status={status}
        projects={[{ key: "SCRUM", name: "Scrum" }]}
        tasks={[]}
        project="SCRUM"
        filters={{ myIssues: false, unresolved: true, currentSprint: false, statuses: [] }}
        columns={columns}
        loading={false}
        onChangeConfig={onChangeConfig}
        onRefresh={vi.fn()}
        onTransition={vi.fn()}
        onOpenItem={vi.fn()}
        onOpenTask={vi.fn()}
        onCreateTask={vi.fn()}
        filterableStatuses={["To Do", "Done"]}
      />,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Filter by status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Done" }));

    expect(onChangeConfig).toHaveBeenCalledWith({ statuses: ["Done"] });
  });
});
