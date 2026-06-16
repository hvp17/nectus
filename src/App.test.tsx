import { beforeEach, describe, vi } from "vitest";
import { api } from "./api";
import { defineAppSmokeTests } from "./test/appSmokeTests";
import { defineAppTaskBoardTests } from "./test/appTaskBoardTests";
import { defineAppTaskCreationTests } from "./test/appTaskCreationTests";
import { defineAppWorkspacesTests } from "./test/appWorkspacesTests";
import { defineAppSidebarTests } from "./test/appSidebarTests";

vi.mock("./api", () => ({
  api: {
    listRepos: vi.fn(),
    listAgentProfiles: vi.fn(),
    listTasks: vi.fn(),
    createTask: vi.fn(),
    createCrossRepoTask: vi.fn(),
    pickRepositoryFolder: vi.fn(),
    addRepo: vi.fn(),
    setRepoCollapsed: vi.fn().mockResolvedValue(undefined),
    setWorkspaceCollapsed: vi.fn().mockResolvedValue(undefined),
    updateTaskMetadata: vi.fn(),
    deleteTask: vi.fn(),
    listWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
    sendSystemNotification: vi.fn(),
    getAppSettings: vi.fn(),
    updateAppSettings: vi.fn(),
    upsertAgentProfile: vi.fn(),
    startPairLoop: vi.fn(),
    runPairReview: vi.fn(),
    stopPairLoop: vi.fn(),
    getTaskReviewLoop: vi.fn(),
    listTaskReviewRuns: vi.fn(),
    listPrReviews: vi.fn().mockResolvedValue([]),
    listPrReviewRuns: vi.fn().mockResolvedValue([]),
    listAcpProviders: vi.fn().mockResolvedValue([]),
    getTaskChat: vi.fn().mockResolvedValue({ session: null, messages: [] }),
    acpStartChat: vi.fn(),
    acpSendPrompt: vi.fn(),
    acpRespondPermission: vi.fn(),
    acpStopChat: vi.fn(),
    listChatCheckpoints: vi.fn().mockResolvedValue([]),
    githubStatus: vi.fn().mockResolvedValue({ installed: false, authenticated: false, account: null }),
    githubPullRequestStatus: vi.fn(),
    jiraListProjects: vi.fn().mockResolvedValue([]),
    jiraSearchBoard: vi.fn().mockResolvedValue([]),
    jiraGetWorkItem: vi.fn(),
    jiraTransitionWorkItem: vi.fn(),
    jiraAssignWorkItem: vi.fn(),
    jiraCommentWorkItem: vi.fn(),
    jiraRestStatus: vi
      .fn()
      .mockResolvedValue({ connected: false, site: null, email: null, error: null }),
    jiraListTransitions: vi.fn().mockResolvedValue([]),
    jiraProjectStatuses: vi.fn().mockResolvedValue([]),
    setJiraApiToken: vi.fn(),
    clearJiraApiToken: vi.fn(),
    setTaskJiraLink: vi.fn(),
    getDiagnosticLogs: vi.fn().mockResolvedValue([]),
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
      {
        id: 3,
        name: "OpenCode",
        agentKind: "opencode",
        command: "opencode",
        model: null,
        args: [],
        env: {},
        createdAt: "2026-05-14T00:00:00.000Z",
        updatedAt: "2026-05-14T00:00:00.000Z",
      },
    ]);
    mockedApi.listAcpProviders.mockResolvedValue([
      {
        id: "codex",
        agentKind: "codex",
        displayName: "Codex",
        launch: { command: "codex-acp", args: [] },
        capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
        maturity: "preview",
      },
      {
        id: "claude",
        agentKind: "claude",
        displayName: "Claude Code",
        launch: { command: "npx", args: ["-y", "@agentclientprotocol/claude-agent-acp"] },
        capabilities: { sessionLoad: "expected", permissions: "expected", images: "unknown" },
        maturity: "stable",
      },
      {
        id: "opencode",
        agentKind: "opencode",
        displayName: "OpenCode",
        launch: { command: "opencode", args: ["acp"] },
        capabilities: { sessionLoad: "unknown", permissions: "unknown", images: "unknown" },
        maturity: "preview",
      },
    ]);
    mockedApi.acpStartChat.mockResolvedValue({
      id: "chat-11",
      taskId: 11,
      agentProfileId: 2,
      acpSessionId: null,
      cwd: "/tmp/wt",
      createdAt: "2026-05-14T00:00:00.000Z",
      updatedAt: "2026-05-14T00:00:00.000Z",
    });
    mockedApi.acpSendPrompt.mockResolvedValue(undefined);
    mockedApi.getTaskChat.mockResolvedValue({ session: null, messages: [] });
    mockedApi.listChatCheckpoints.mockResolvedValue([]);
    mockedApi.listTasks.mockResolvedValue([]);
    mockedApi.listWorkspaces.mockResolvedValue([]);
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
    // Re-establish the default each test: clearAllMocks resets call history but not
    // implementations, so a test that connects a token would otherwise leak a
    // connected status into later tests.
    mockedApi.jiraRestStatus.mockResolvedValue({
      connected: false,
      site: null,
      email: null,
      error: null,
    });
  });

  defineAppSmokeTests();
  defineAppTaskCreationTests();
  defineAppTaskBoardTests();
  defineAppWorkspacesTests();
  defineAppSidebarTests();
});
