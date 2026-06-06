import { describe, expect, it } from "vitest";
import { deriveColumns } from "./useJira";
import type { JiraStatusDef, JiraWorkItem } from "../types";

const item = (key: string, statusName: string): JiraWorkItem => ({
  key,
  summary: key,
  statusName,
  statusCategory: "to_do",
  issueType: null,
  priority: null,
  assignee: null,
  url: null,
  description: null,
});

describe("deriveColumns", () => {
  it("derives from items when no project statuses (current behavior)", () => {
    const cols = deriveColumns([item("A-1", "To Do")], [], []);
    expect(cols.map((c) => c.statusName)).toEqual(["To Do"]);
  });

  it("renders every project status as a column, including empty ones", () => {
    const defs: JiraStatusDef[] = [
      { id: "1", name: "To Do", category: "to_do" },
      { id: "2", name: "In Progress", category: "in_progress" },
      { id: "3", name: "Done", category: "done" },
    ];
    const cols = deriveColumns([item("A-1", "To Do")], defs, []);
    expect(cols.map((c) => c.statusName)).toEqual(["To Do", "In Progress", "Done"]);
    expect(cols[2].items).toEqual([]); // Done column empty but present
  });

  it("narrows the skeleton to the active status filter", () => {
    const defs: JiraStatusDef[] = [
      { id: "1", name: "To Do", category: "to_do" },
      { id: "3", name: "Done", category: "done" },
    ];
    const cols = deriveColumns([], defs, ["Done"]);
    expect(cols.map((c) => c.statusName)).toEqual(["Done"]);
  });
});
