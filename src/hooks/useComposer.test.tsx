import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { appSettingsFixture, resetAppStore, seedBootstrapQueries, testTimestamp } from "../test/testUtils";
import type { JiraStatus, JiraWorkItem, Repo } from "../types";
import { useComposer } from "./useComposer";

vi.mock("../api", () => ({
  api: {
    createTask: vi.fn(),
    createCrossRepoTask: vi.fn(),
    startSession: vi.fn(),
    jiraGetWorkItem: vi.fn(),
    jiraStatus: vi.fn(),
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
});
