import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { resetAppStore } from "../test/testUtils";
import type { AppSettings, Repo } from "../types";
import { useProjectActions } from "./useProjectActions";

vi.mock("../api", () => ({
  api: {
    pickRepositoryFolder: vi.fn(),
    addRepo: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const timestamp = "2026-06-09T00:00:00.000Z";

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 3,
    name: "nectus-desktop",
    path: "/tmp/nectus-desktop",
    defaultWorktreeRoot: "/tmp/nectus-desktop-worktrees",
    createdAt: timestamp,
    collapsed: false,
    ...overrides,
  };
}

function settings(): AppSettings {
  return {
    defaultAgentProfileId: null,
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
  };
}

function seedBootstrapQueries(queryClient: QueryClient) {
  queryClient.setQueryData(queryKeys.repos(), []);
  queryClient.setQueryData(queryKeys.workspaces(), []);
  queryClient.setQueryData(queryKeys.agentProfiles(), []);
  queryClient.setQueryData(queryKeys.settings(), settings());
  queryClient.setQueryData(queryKeys.tasks(), []);
}

function setup() {
  const queryClient = createQueryClient();
  seedBootstrapQueries(queryClient);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useProjectActions(), { wrapper });
  return { ...hook, queryClient };
}

function expectBootstrapInvalidated(queryClient: QueryClient) {
  const expectInvalidated = (queryKey: QueryKey) =>
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  expectInvalidated(queryKeys.repos());
  expectInvalidated(queryKeys.workspaces());
  expectInvalidated(queryKeys.agentProfiles());
  expectInvalidated(queryKeys.settings());
  expectInvalidated(queryKeys.tasks());
}

describe("useProjectActions", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("does not add or refresh when folder selection is cancelled", async () => {
    mockedApi.pickRepositoryFolder.mockResolvedValue(null);
    useAppStore.setState({ selectedRepoId: 9 });
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockedApi.addRepo).not.toHaveBeenCalled();
    expect(useAppStore.getState().selectedRepoId).toBe(9);
    expect(queryClient.getQueryState(queryKeys.repos())?.isInvalidated).toBe(false);
  });

  it("adds the selected repo, selects it, and refreshes bootstrap data", async () => {
    const added = repo({ id: 42, name: "platform" });
    mockedApi.pickRepositoryFolder.mockResolvedValue("/tmp/platform");
    mockedApi.addRepo.mockResolvedValue(added);
    const { result, queryClient } = setup();

    await act(async () => {
      await result.current.addProject();
    });

    expect(mockedApi.addRepo).toHaveBeenCalledWith("/tmp/platform");
    expect(useAppStore.getState().selectedRepoId).toBe(added.id);
    expect(useAppStore.getState().message).toBe("Added platform");
    expectBootstrapInvalidated(queryClient);
  });
});
