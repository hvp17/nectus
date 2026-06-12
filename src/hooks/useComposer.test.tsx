import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { appSettingsFixture, resetAppStore, seedBootstrapQueries, testTimestamp } from "../test/testUtils";
import type { JiraStatus, JiraWorkItem, Repo, TaskSummary } from "../types";
import { useComposer } from "./useComposer";

vi.mock("../api", () => ({
  api: {
    createTask: vi.fn(),
    createCrossRepoTask: vi.fn(),
    setTaskJiraLink: vi.fn(),
    startSession: vi.fn(),
    jiraGetWorkItem: vi.fn(),
    jiraStatus: vi.fn(),
    jiraRestStatus: vi.fn(),
    listRepos: vi.fn(),
    listWorkspaces: vi.fn(),
    listAgentProfiles: vi.fn(),
    getAppSettings: vi.fn(),
    listTasks: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api, true);

const repo: Repo = {
  id: 7,
  name: "nectus",
  path: "/tmp/nectus",
  defaultWorktreeRoot: "/tmp/worktrees/nectus",
  createdAt: testTimestamp,
  collapsed: false,
};

const jiraStatus: JiraStatus = {
  installed: true,
  authenticated: true,
  site: "example.atlassian.net",
};

const story: JiraWorkItem = {
  key: "SCRUM-3",
  summary: "Wire launch agent",
  statusName: "To Do",
  statusCategory: "to_do",
  issueType: "Story",
  priority: null,
  assignee: null,
  url: null,
  description: "Implement the handoff.",
};

function setup() {
  const queryClient = createQueryClient();
  seedBootstrapQueries(queryClient, {
    repos: [repo],
    settings: appSettingsFixture({ defaultAgentProfileId: 2 }),
  });
  queryClient.setQueryData(queryKeys.jira.status(), jiraStatus);
  queryClient.setQueryData(queryKeys.jira.restStatus(), { connected: false });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useComposer(), { wrapper });
}

describe("useComposer", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("stores the launch agent when creating a task from a JIRA story", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.createTaskFromStory(story, 2);
    });

    const state = useAppStore.getState();
    expect(state.newTaskAgentProfileId).toBe(2);
    expect(state.newTaskTitle).toBe(story.summary);
    expect(state.newTaskPrompt).toBe(story.description);
    expect(state.pendingJiraLink).toMatchObject({
      key: story.key,
      summary: story.summary,
      url: "https://example.atlassian.net/browse/SCRUM-3",
    });
    expect(state.createTaskOpen).toBe(true);
    expect(mockedApi.jiraGetWorkItem).not.toHaveBeenCalled();
  });

  it("attaches the linked JIRA story to a cross-repo task created from a story", async () => {
    const created = { id: 500, title: story.summary, branchName: "feat/cross" } as TaskSummary;
    mockedApi.createCrossRepoTask.mockResolvedValue(created);
    mockedApi.startSession.mockResolvedValue({} as never);
    const { result } = setup();

    // Seed the composer from the story (Project mode, pendingJiraLink set)...
    await act(async () => {
      await result.current.createTaskFromStory(story, 2);
    });
    // ...then switch into cross-repo Workspace mode (as the composer toggle does).
    act(() => {
      const store = useAppStore.getState();
      store.setNewTaskWorkspaceId(1);
      store.setNewTaskRepoIds([7, 8]);
    });

    await act(async () => {
      await result.current.createTask();
    });

    // The JIRA link rides along on the create call itself (no follow-up
    // setTaskJiraLink), matching the single-repo create path.
    expect(mockedApi.createCrossRepoTask).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 1,
        repoIds: [7, 8],
        jiraIssueKey: story.key,
        jiraIssueSummary: story.summary,
        jiraIssueUrl: "https://example.atlassian.net/browse/SCRUM-3",
      }),
    );
    expect(mockedApi.setTaskJiraLink).not.toHaveBeenCalled();
  });
});
