import type { ReactNode } from "react";
import { createElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { deriveColumns, useJira } from "./useJira";
import type { JiraRestStatus, JiraStatus, JiraStatusDef, JiraWorkItem } from "../types";

function makeWrapper(client = createQueryClient()) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

vi.mock("../api", () => ({
  api: {
    jiraStatus: vi.fn(),
    jiraRestStatus: vi.fn(),
    jiraListProjects: vi.fn(),
    jiraProjectStatuses: vi.fn(),
    jiraSearchBoard: vi.fn(),
    jiraTransitionWorkItem: vi.fn(),
    jiraAssignWorkItem: vi.fn(),
    jiraCommentWorkItem: vi.fn(),
    jiraCreateWorkItem: vi.fn(),
    setJiraApiToken: vi.fn(),
    clearJiraApiToken: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api, true);

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

const connectedStatus: JiraStatus = { installed: true, authenticated: true };
const disconnectedRestStatus: JiraRestStatus = { connected: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.jiraStatus.mockResolvedValue(connectedStatus);
  mockedApi.jiraRestStatus.mockResolvedValue(disconnectedRestStatus);
  mockedApi.jiraListProjects.mockResolvedValue([]);
  mockedApi.jiraProjectStatuses.mockResolvedValue([]);
  mockedApi.jiraSearchBoard.mockResolvedValue([item("A-1", "To Do")]);
  mockedApi.jiraTransitionWorkItem.mockResolvedValue(undefined);
  mockedApi.jiraAssignWorkItem.mockResolvedValue(undefined);
  mockedApi.jiraCommentWorkItem.mockResolvedValue(undefined);
  mockedApi.jiraCreateWorkItem.mockResolvedValue(item("A-2", "To Do"));
  mockedApi.setJiraApiToken.mockResolvedValue(disconnectedRestStatus);
  mockedApi.clearJiraApiToken.mockResolvedValue(undefined);
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

describe("useJira", () => {
  it("refreshes the board after adding a comment", async () => {
    const setMessage = vi.fn();
    const client = createQueryClient();
    const { result } = renderHook(
      () =>
        useJira({
          active: true,
          configured: true,
          project: "A",
          statusFilter: [],
          setMessage,
        }),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(mockedApi.jiraSearchBoard).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.comment("A-1", "Looks good");
    });

    await waitFor(() => expect(mockedApi.jiraSearchBoard).toHaveBeenCalledTimes(2));
    expect(mockedApi.jiraCommentWorkItem).toHaveBeenCalledWith("A-1", "Looks good");
    expect(setMessage).toHaveBeenCalledWith("Comment added to A-1");
  });
});
