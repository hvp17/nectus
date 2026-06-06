import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithTooltipProvider } from "../test/testUtils";
import type { JiraTransition, JiraWorkItem } from "../types";
import { JiraWorkItemPanel } from "./JiraWorkItemDialog";

const item: JiraWorkItem = {
  key: "SCRUM-3",
  summary: "Custom workflow story",
  statusName: "To Do",
  statusCategory: "to_do",
  issueType: "Task",
  priority: null,
  assignee: null,
  url: null,
  description: null,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof JiraWorkItemPanel>> = {}) {
  const props = {
    item,
    statusOptions: ["To Do"],
    restConnected: false,
    onListTransitions: vi.fn(async () => [] as JiraTransition[]),
    site: "example.atlassian.net",
    agentProfiles: [],
    onClose: vi.fn(),
    onTransition: vi.fn(),
    onAssign: vi.fn(),
    onComment: vi.fn(),
    onCreateTask: vi.fn(),
    onPickAgent: vi.fn(),
    onOpenUrl: vi.fn(),
    ...overrides,
  };
  renderWithTooltipProvider(<JiraWorkItemPanel {...props} />);
  return props;
}

describe("JiraWorkItemPanel status dropdown", () => {
  it("offers the issue's legal REST transitions when connected", async () => {
    const onListTransitions = vi.fn(async () => [
      { id: "21", name: "Start", toStatusName: "In Progress", toStatusCategory: "in_progress" },
      { id: "31", name: "Finish", toStatusName: "Done", toStatusCategory: "done" },
    ] as JiraTransition[]);

    renderPanel({ restConnected: true, statusOptions: ["To Do"], onListTransitions });

    expect(onListTransitions).toHaveBeenCalledWith("SCRUM-3");
    fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
    // "In Progress"/"Done" come only from the REST transitions, not the board columns.
    expect(await screen.findByRole("option", { name: "In Progress" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Done" })).toBeInTheDocument();
  });

  it("falls back to board-derived options when not connected", () => {
    const onListTransitions = vi.fn(async () => [] as JiraTransition[]);
    renderPanel({ restConnected: false, statusOptions: ["To Do", "Blocked"], onListTransitions });

    expect(onListTransitions).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
    expect(screen.getByRole("option", { name: "Blocked" })).toBeInTheDocument();
  });

  it("degrades to board-derived options when the REST lookup fails", async () => {
    // Connected, but the transitions call fails (e.g. revoked/stale token). The
    // dropdown must fall back to the board-derived options, not strand the user on
    // only the current status.
    const onListTransitions = vi.fn(async () => {
      throw new Error("401 Unauthorized");
    });
    renderPanel({ restConnected: true, statusOptions: ["To Do", "Blocked"], onListTransitions });

    expect(onListTransitions).toHaveBeenCalledWith("SCRUM-3");
    fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
    expect(await screen.findByRole("option", { name: "Blocked" })).toBeInTheDocument();
  });
});
