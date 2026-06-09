import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { resetAppStore } from "../test/testUtils";
import type { AgentProfile, AppSettings, Repo, Workspace } from "../types";
import { useShellBootstrap } from "./useShellBootstrap";

vi.mock("../api", () => ({
  api: {
    listRepos: vi.fn(),
    listWorkspaces: vi.fn(),
    listAgentProfiles: vi.fn(),
    getAppSettings: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const repo: Repo = {
  id: 1,
  name: "nectus",
  path: "/tmp/nectus",
  defaultWorktreeRoot: "~/.nectus/worktrees/nectus",
  createdAt: "2026-06-09T00:00:00.000Z",
  collapsed: false,
};

const workspace: Workspace = {
  id: 5,
  name: "Frontend",
  repoIds: [1],
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  collapsed: false,
};

const codexProfile: AgentProfile = {
  id: 1,
  name: "Codex",
  agentKind: "codex",
  command: "codex",
  model: null,
  args: [],
  env: {},
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

const claudeProfile: AgentProfile = {
  ...codexProfile,
  id: 2,
  name: "Claude",
  agentKind: "claude",
  command: "claude",
};

const settings: AppSettings = {
  defaultAgentProfileId: 2,
  defaultWorktreeRootPattern: "~/.nectus/worktrees/{repo}",
  defaultBranchPrefix: "tgadliauskas/",
  jiraBoardJql: null,
  jiraSiteUrl: null,
  jiraBoardProject: null,
  jiraFilterMyIssues: false,
  jiraFilterUnresolved: false,
  jiraFilterCurrentSprint: false,
  jiraRestEmail: null,
  jiraFilterStatuses: [],
  theme: "system",
  density: "comfortable",
  updatedAt: "2026-06-09T00:00:00.000Z",
};

function setup({
  repos = [repo],
  workspaces = [workspace],
  agentProfiles = [codexProfile, claudeProfile],
  appSettings = settings,
}: {
  repos?: Repo[];
  workspaces?: Workspace[];
  agentProfiles?: AgentProfile[];
  appSettings?: AppSettings;
} = {}) {
  mockedApi.listRepos.mockResolvedValue(repos);
  mockedApi.listWorkspaces.mockResolvedValue(workspaces);
  mockedApi.listAgentProfiles.mockResolvedValue(agentProfiles);
  mockedApi.getAppSettings.mockResolvedValue(appSettings);

  const queryClient = createQueryClient();
  queryClient.setQueryData(queryKeys.repos(), repos);
  queryClient.setQueryData(queryKeys.workspaces(), workspaces);
  queryClient.setQueryData(queryKeys.agentProfiles(), agentProfiles);
  queryClient.setQueryData(queryKeys.settings(), appSettings);

  renderHook(() => useShellBootstrap(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

const store = () => useAppStore.getState();

describe("useShellBootstrap", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("selects the first repo and configured default agent profile on boot", async () => {
    setup();

    await waitFor(() => {
      expect(store().selectedRepoId).toBe(1);
      expect(store().selectedAgentProfileId).toBe(2);
    });
  });

  it("falls back to the first agent profile when settings has no default", async () => {
    setup({ appSettings: { ...settings, defaultAgentProfileId: null } });

    await waitFor(() => expect(store().selectedAgentProfileId).toBe(1));
  });

  it("falls back to the first profile when the configured default is stale", async () => {
    setup({ appSettings: { ...settings, defaultAgentProfileId: 99 } });

    await waitFor(() => expect(store().selectedAgentProfileId).toBe(1));
  });

  it("does not replace existing repo or agent selections", () => {
    store().setSelectedRepoId(99);
    store().setSelectedAgentProfileId(88);

    setup();

    expect(store().selectedRepoId).toBe(99);
    expect(store().selectedAgentProfileId).toBe(88);
  });

  it("clears the active workspace when the workspace no longer exists", async () => {
    store().setActiveWorkspaceId(99);

    setup({ workspaces: [workspace] });

    await waitFor(() => expect(store().activeWorkspaceId).toBeUndefined());
  });
});
