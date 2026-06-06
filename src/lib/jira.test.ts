import { describe, expect, it } from "vitest";
import { jiraBrowseUrl, syncSelectedWorkItem } from "./jira";
import type { JiraWorkItem } from "../types";

function workItem(overrides: Partial<JiraWorkItem> & { key: string }): JiraWorkItem {
  return {
    summary: "A story",
    statusName: "To Do",
    statusCategory: "to_do",
    assignee: null,
    ...overrides,
  };
}

describe("jiraBrowseUrl", () => {
  it("builds the canonical browse URL from a bare site host", () => {
    expect(jiraBrowseUrl("acme.atlassian.net", "PROJ-1")).toBe(
      "https://acme.atlassian.net/browse/PROJ-1",
    );
  });

  it("normalizes a site that already includes a scheme or trailing slash", () => {
    expect(jiraBrowseUrl("https://acme.atlassian.net/", "SCRUM-2")).toBe(
      "https://acme.atlassian.net/browse/SCRUM-2",
    );
  });

  it("returns null when the site or key is missing", () => {
    expect(jiraBrowseUrl(null, "PROJ-1")).toBeNull();
    expect(jiraBrowseUrl("acme.atlassian.net", null)).toBeNull();
    expect(jiraBrowseUrl(undefined, undefined)).toBeNull();
  });
});

describe("syncSelectedWorkItem", () => {
  it("re-reads the selected item from the refreshed board so a transition shows", () => {
    const selected = workItem({ key: "PROJ-1", statusName: "To Do", statusCategory: "to_do" });
    const refreshed = [
      workItem({ key: "PROJ-1", statusName: "In Progress", statusCategory: "in_progress", assignee: "Ada" }),
      workItem({ key: "PROJ-2" }),
    ];

    expect(syncSelectedWorkItem(selected, refreshed)).toEqual(refreshed[0]);
  });

  it("keeps a selection that is not on the board (e.g. a freshly created item)", () => {
    const created = workItem({ key: "NEW-9" });
    expect(syncSelectedWorkItem(created, [workItem({ key: "PROJ-1" })])).toBe(created);
  });

  it("passes through a null selection", () => {
    expect(syncSelectedWorkItem(null, [workItem({ key: "PROJ-1" })])).toBeNull();
  });
});
