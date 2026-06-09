import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import {
  appSettingsFixture,
  expectBootstrapInvalidated,
  resetAppStore,
  seedBootstrapQueries,
  testTimestamp,
} from "../test/testUtils";
import type { AgentProfile, AppSettings, AppSettingsInput } from "../types";
import { useSettingsActions } from "./useSettingsActions";

vi.mock("../api", () => ({
  api: {
    updateAppSettings: vi.fn(),
    upsertAgentProfile: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

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
    createdAt: testTimestamp,
    updatedAt: testTimestamp,
    ...rest,
  };
}

function setup({
  initialSettings = appSettingsFixture({ defaultAgentProfileId: 1 }),
  agentProfiles = [profile({ id: 1 })],
}: {
  initialSettings?: AppSettings;
  agentProfiles?: AgentProfile[];
} = {}) {
  const queryClient = createQueryClient();
  seedBootstrapQueries(queryClient, { settings: initialSettings, agentProfiles });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useSettingsActions(), { wrapper });
  return { ...hook, queryClient };
}

describe("useSettingsActions", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("keeps settings actions stable when dependencies are stable", () => {
    const { result, rerender } = setup();

    const firstSaveAppSettings = result.current.saveAppSettings;
    const firstSaveAgentProfile = result.current.saveAgentProfile;
    rerender();

    expect(result.current.saveAppSettings).toBe(firstSaveAppSettings);
    expect(result.current.saveAgentProfile).toBe(firstSaveAgentProfile);
  });

  it("stores saved settings, selects the returned default agent, and invalidates bootstrap reads", async () => {
    const input = settingsInput();
    const updated = appSettingsFixture({
      ...input,
      updatedAt: "2026-06-09T00:01:00.000Z",
    });
    mockedApi.updateAppSettings.mockResolvedValue(updated);
    useAppStore.setState({ selectedAgentProfileId: 1 });
    const { result, queryClient } = setup({
      agentProfiles: [profile({ id: 1, name: "Codex" }), profile({ id: 2, name: "Claude" })],
    });

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveAppSettings(input);
    });

    expect(returned).toEqual(updated);
    expect(mockedApi.updateAppSettings).toHaveBeenCalledWith(input);
    expect(queryClient.getQueryData(queryKeys.settings())).toEqual(updated);
    expect(useAppStore.getState().selectedAgentProfileId).toBe(2);
    expect(useAppStore.getState().message).toBe("Settings saved");
    expectBootstrapInvalidated(queryClient);
  });

  it("resolves a stale returned default agent before updating shell selection", async () => {
    const input = settingsInput({ defaultAgentProfileId: 99 });
    const updated = appSettingsFixture({
      ...input,
      updatedAt: "2026-06-09T00:03:00.000Z",
    });
    mockedApi.updateAppSettings.mockResolvedValue(updated);
    useAppStore.setState({ selectedAgentProfileId: 2 });
    const { result, queryClient } = setup({
      agentProfiles: [profile({ id: 1, name: "Codex" }), profile({ id: 2, name: "Claude" })],
    });

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveAppSettings(input);
    });

    expect(returned).toEqual(updated);
    expect(queryClient.getQueryData(queryKeys.settings())).toEqual(updated);
    expect(useAppStore.getState().selectedAgentProfileId).toBe(1);
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
