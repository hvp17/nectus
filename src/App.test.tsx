import { beforeEach, describe, vi } from "vitest";
import { api } from "./api";
import { defineAppSmokeTests } from "./test/appSmokeTests";
import { defineAppTaskBoardTests } from "./test/appTaskBoardTests";
import { defineAppTaskCreationTests } from "./test/appTaskCreationTests";

vi.mock("./api", () => ({
  api: {
    listRepos: vi.fn(),
    listAgentProfiles: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    pickRepositoryFolder: vi.fn(),
    addRepo: vi.fn(),
    updateTaskMetadata: vi.fn(),
    deleteTask: vi.fn(),
    startSession: vi.fn(),
    resumeSession: vi.fn(),
    stopSession: vi.fn(),
    resizeSession: vi.fn(),
    sendSessionInput: vi.fn(),
    sessionOutputSnapshot: vi.fn(),
    sendSystemNotification: vi.fn(),
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
    upsertAgentProfile: vi.fn(),
    startPairLoop: vi.fn(),
    runPairReview: vi.fn(),
    stopPairLoop: vi.fn(),
    getTaskReviewLoop: vi.fn(),
    listTaskReviewRuns: vi.fn(),
    githubStatus: vi.fn().mockResolvedValue({ installed: false, authenticated: false, account: null }),
    createGithubPullRequest: vi.fn(),
    githubPullRequestStatus: vi.fn(),
    jiraStatus: vi
      .fn()
      .mockResolvedValue({ installed: false, authenticated: false, account: null, site: null }),
    jiraListProjects: vi.fn().mockResolvedValue([]),
    jiraSearchBoard: vi.fn().mockResolvedValue([]),
    jiraGetWorkItem: vi.fn(),
    jiraTransitionWorkItem: vi.fn(),
    jiraAssignWorkItem: vi.fn(),
    jiraCommentWorkItem: vi.fn(),
    setTaskJiraLink: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

describe("App", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    window.history.pushState({}, "", "/");
    mockedApi.listRepos.mockResolvedValue([]);
    mockedApi.listAgentProfiles.mockResolvedValue([
      {
        id: 1,
        name: "Codex",
        agentKind: "codex",
        command: "codex",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
      {
        id: 2,
        name: "Claude",
        agentKind: "claude",
        command: "claude",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listTasks.mockResolvedValue([]);
    mockedApi.getAppSettings.mockResolvedValue({
      defaultAgentProfileId: 1,
      defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
      defaultBranchPrefix: null,
      jiraBoardJql: null,
      jiraSiteUrl: null,
      jiraBoardProject: null,
      jiraFilterMyIssues: false,
      jiraFilterUnresolved: true,
      jiraFilterCurrentSprint: false,
      jiraFilterStatuses: [],
      theme: "system",
      density: "comfortable",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    mockedApi.updateAppSettings.mockImplementation(async (settings) => ({
      ...settings,
      updatedAt: "2026-05-14T00:01:00.000Z",
    }));
    mockedApi.getTaskReviewLoop.mockResolvedValue(null);
    mockedApi.listTaskReviewRuns.mockResolvedValue([]);
  });

  defineAppSmokeTests();
  defineAppTaskCreationTests();
  defineAppTaskBoardTests();
});
