import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { resetAppStore } from "../test/testUtils";
import type { AgentProfile, AppSettings, AppSettingsInput } from "../types";
import { useSettingsActions } from "./useSettingsActions";

vi.mock("../api", () => ({
  api: {
    updateAppSettings: vi.fn(),
    upsertAgentProfile: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const timestamp = "2026-06-09T00:00:00.000Z";

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    defaultAgentProfileId: 1,
    defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
    defaultBranchPrefix: "tgadliauskas/",
    jiraBoardJql: null,
    jiraSiteUrl: null,
    jiraBoardProject: null,
    jiraFilterMyIssues: false,
    jiraFilterUnresolved: true,
    jiraFilterCurrentSprint: false,
    jiraRestEmail: null,
    jiraFilterStatuses: [],
    theme: "system",
    density: "comfortable",
    updatedAt: timestamp,
    ...overrides,
  };
}

function settingsInput(overrides: Partial<AppSettingsInput> = {}): AppSettingsInput {
  return {
    defaultAgentProfileId: 2,
    defaultWorktreeRootPattern: "~/.nectus/worktrees/{repoName}",
    defaultBranchPrefix: "tgadliauskas/",
    jiraBoardJql: null,
    jiraSiteUrl: null,
    jiraBoardProject: null,
    jiraFilterMyIssues: false,
    jiraFilterUnresolved: true,
    jiraFilterCurrentSprint: false,
    jiraFilterStatuses: [],
    theme: "dark",
    density: "compact",
    ...overrides,
  };
}

function profile(overrides: Partial<AgentProfile> & { id: number }): AgentProfile {
  const { id, ...rest } = overrides;
  return {
    id,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    ...rest,
  };
}

function seedBootstrapQueries(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.repos(), []);
  queryClient.setQueryData(queryKeys.workspaces(), []);
  queryClient.setQueryData(queryKeys.tasks(), []);
}

function setup({
  initialSettings = settings(),
  agentProfiles = [profile({ id: 1 })],
}: {
  initialSettings?: AppSettings;
  agentProfiles?: AgentProfile[];
} = {}) {
  const queryClient = createQueryClient();
  seedBootstrapQueries(queryClient);
  queryClient.setQueryData(queryKeys.settings(), initialSettings);
  queryClient.setQueryData(queryKeys.agentProfiles(), agentProfiles);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSettingsActions(), { wrapper });
  return { ...hook, queryClient };
}

function expectInvalidated(queryClient: QueryClient, queryKey: QueryKey) {
  expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
}

describe("useSettingsActions", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("stores saved settings, selects the returned default agent, and invalidates bootstrap reads", async () => {
    const input = settingsInput();
    const updated = settings({
      ...input,
      updatedAt: "2026-06-09T00:01:00.000Z",
    });
    mockedApi.updateAppSettings.mockResolvedValue(updated);
    useAppStore.setState({ selectedAgentProfileId: 1 });
    const { result, queryClient } = setup();

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveAppSettings(input);
    });

    expect(returned).toEqual(updated);
    expect(mockedApi.updateAppSettings).toHaveBeenCalledWith(input);
    expect(queryClient.getQueryData(queryKeys.settings())).toEqual(updated);
    expect(useAppStore.getState().selectedAgentProfileId).toBe(2);
    expect(useAppStore.getState().message).toBe("Settings saved");
    expectInvalidated(queryClient, queryKeys.repos());
    expectInvalidated(queryClient, queryKeys.workspaces());
    expectInvalidated(queryClient, queryKeys.agentProfiles());
    expectInvalidated(queryClient, queryKeys.settings());
    expectInvalidated(queryClient, queryKeys.tasks());
  });

  it("upserts saved agent profiles into the cache", async () => {
    const existing = profile({ id: 1, name: "Codex" });
    const saved = profile({
      id: 1,
      name: "Codex Max",
      model: "gpt-5.1-codex-max",
      args: ["--profile", "work"],
      env: { CODEX_HOME: "/tmp/codex" },
      updatedAt: "2026-06-09T00:02:00.000Z",
    });
    const draft = {
      id: existing.id,
      name: saved.name,
      agentKind: saved.agentKind,
      command: saved.command,
      model: saved.model,
      args: saved.args,
      env: saved.env,
    };
    mockedApi.upsertAgentProfile.mockResolvedValue(saved);
    const { result, queryClient } = setup({ agentProfiles: [existing] });

    let returned: AgentProfile | undefined;
    await act(async () => {
      returned = await result.current.saveAgentProfile(draft);
    });

    expect(returned).toEqual(saved);
    expect(mockedApi.upsertAgentProfile).toHaveBeenCalledWith(draft);
    expect(queryClient.getQueryData(queryKeys.agentProfiles())).toEqual([saved]);
    expect(useAppStore.getState().message).toBe("Saved Codex Max");
  });
});
