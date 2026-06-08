import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { queryKeys } from "../queries/keys";
import { useSidebarCollapse } from "./useSidebarCollapse";
import type { Repo, Workspace } from "../types";

vi.mock("../api", () => ({
  api: {
    setRepoCollapsed: vi.fn(),
    setWorkspaceCollapsed: vi.fn(),
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

function setup() {
  const client = createQueryClient();
  client.setQueryData<Repo[]>(queryKeys.repos(), [repo]);
  client.setQueryData<Workspace[]>(queryKeys.workspaces(), [workspace]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useSidebarCollapse(), { wrapper });
  const repoCollapsed = () => client.getQueryData<Repo[]>(queryKeys.repos())?.[0].collapsed;
  const workspaceCollapsed = () =>
    client.getQueryData<Workspace[]>(queryKeys.workspaces())?.[0].collapsed;
  return { result, repoCollapsed, workspaceCollapsed };
}

describe("useSidebarCollapse", () => {
  beforeEach(() => {
    mockedApi.setRepoCollapsed.mockReset();
    mockedApi.setWorkspaceCollapsed.mockReset();
  });

  it("folds a repo optimistically in the cache and persists it", () => {
    mockedApi.setRepoCollapsed.mockResolvedValue(undefined);
    const { result, repoCollapsed } = setup();

    result.current.setRepoCollapsed(1, true);

    expect(repoCollapsed()).toBe(true);
    expect(mockedApi.setRepoCollapsed).toHaveBeenCalledWith(1, true);
  });

  it("reverts the repo fold when the persist fails", async () => {
    mockedApi.setRepoCollapsed.mockRejectedValue(new Error("db down"));
    const { result, repoCollapsed } = setup();

    result.current.setRepoCollapsed(1, true);
    expect(repoCollapsed()).toBe(true); // optimistic write lands first

    await waitFor(() => expect(repoCollapsed()).toBe(false)); // then reverts
  });

  it("reverts the workspace fold when the persist fails", async () => {
    mockedApi.setWorkspaceCollapsed.mockRejectedValue(new Error("db down"));
    const { result, workspaceCollapsed } = setup();

    result.current.setWorkspaceCollapsed(5, true);
    expect(workspaceCollapsed()).toBe(true);

    await waitFor(() => expect(workspaceCollapsed()).toBe(false));
  });
});
