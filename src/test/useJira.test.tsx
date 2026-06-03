import { describe, it, expect } from "vitest";
import { deriveColumns } from "../hooks/useJira";
import type { JiraStatusCategory, JiraWorkItem } from "../types";

const item = (key: string, statusName: string, statusCategory: JiraStatusCategory): JiraWorkItem => ({
  key,
  summary: key,
  statusName,
  statusCategory,
  issueType: null,
  assignee: null,
  url: null,
  description: null,
});

describe("deriveColumns", () => {
  it("orders columns by status category then name and groups items per status", () => {
    const columns = deriveColumns([
      item("A-1", "Done", "done"),
      item("A-2", "Backlog", "to_do"),
      item("A-3", "Selected", "to_do"),
      item("A-4", "Backlog", "to_do"),
      item("A-5", "In Review", "in_progress"),
    ]);

    expect(columns.map((column) => column.statusName)).toEqual([
      "Backlog",
      "Selected",
      "In Review",
      "Done",
    ]);
    expect(columns[0].items.map((it) => it.key)).toEqual(["A-2", "A-4"]);
  });

  it("returns no column for a status that has no items (auto-derived only)", () => {
    const columns = deriveColumns([item("B-1", "In Progress", "in_progress")]);
    expect(columns).toHaveLength(1);
    expect(columns[0].statusName).toBe("In Progress");
  });

  it("sorts unknown-category statuses last", () => {
    const columns = deriveColumns([
      item("C-1", "Mystery", "unknown"),
      item("C-2", "To Do", "to_do"),
    ]);
    expect(columns.map((column) => column.statusName)).toEqual(["To Do", "Mystery"]);
  });
});
