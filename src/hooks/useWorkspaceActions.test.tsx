import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { createQueryClient } from "../queries/queryClient";
import { useAppStore } from "../store/appStore";
import { expectBootstrapInvalidated, resetAppStore, seedBootstrapQueries, testTimestamp } from "../test/testUtils";
import type { Workspace } from "../types";
import { useWorkspaceActions } from "./useWorkspaceActions";

vi.mock("../api", () => ({
  api: {
    createWorkspace: vi.fn(),
    updateWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 5,
    name: "Platform",
    repoIds: [1, 2],
    createdAt: testTimestamp,
    updatedAt: testTimestamp,
    collapsed: false,
    ...overrides,
  };
}

function setup() {
  const queryClient = createQueryClient();
  seedBootstrapQueries(queryClient);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useWorkspaceActions(), { wrapper });
  return { ...hook, queryClient };
}

describe("useWorkspaceActions", () => {
  beforeEach(() => {
    resetAppStore();
    vi.clearAllMocks();
  });

  it("creates a workspace, focuses it, and refreshes bootstrap data", async () => {
    const created = workspace({ id: 7, name: "Design Systems" });
    mockedApi.createWorkspace.mockResolvedValue(created);
    const { result, queryClient } = setup();

    let returned: Workspace | undefined;
    await act(async () => {
      returned = await result.current.createWorkspace("Design Systems", [1, 2]);
    });

    expect(returned).toEqual(created);
    expect(mockedApi.createWorkspace).toHaveBeenCalledWith("Design Systems", [1, 2]);
    expect(useAppStore.getState().activeWorkspaceId).toBe(created.id);
    expect(useAppStore.getState().message).toBe("Workspace: Created Design Systems");
    expectBootstrapInvalidated(queryClient);
  });

  it("updates a workspace and refreshes bootstrap data", async () => {
    const updated = workspace({ id: 5, name: "Platform+", repoIds: [2] });
    mockedApi.updateWorkspace.mockResolvedValue(updated);
    const { result, queryClient } = setup();

    let returned: Workspace | undefined;
    await act(async () => {
      returned = await result.current.updateWorkspace(5, "Platform+", [2]);
    });

    expect(returned).toEqual(updated);
    expect(mockedApi.updateWorkspace).toHaveBeenCalledWith(5, "Platform+", [2]);
    expect(useAppStore.getState().message).toBe("Workspace: Saved Platform+");
    expectBootstrapInvalidated(queryClient);
  });

  it("clears focus only when deleting the active workspace", async () => {
    mockedApi.deleteWorkspace.mockResolvedValue(undefined);
    const activeRun = setup();
    useAppStore.setState({ activeWorkspaceId: 5 });

    await act(async () => {
      await activeRun.result.current.deleteWorkspace(5);
    });

    expect(mockedApi.deleteWorkspace).toHaveBeenCalledWith(5);
    expect(useAppStore.getState().activeWorkspaceId).toBeUndefined();
    expect(useAppStore.getState().message).toBe("Workspace: Deleted");
    expectBootstrapInvalidated(activeRun.queryClient);

    resetAppStore();
    vi.clearAllMocks();
    mockedApi.deleteWorkspace.mockResolvedValue(undefined);
    const inactiveRun = setup();
    useAppStore.setState({ activeWorkspaceId: 9 });

    await act(async () => {
      await inactiveRun.result.current.deleteWorkspace(5);
    });

    expect(mockedApi.deleteWorkspace).toHaveBeenCalledWith(5);
    expect(useAppStore.getState().activeWorkspaceId).toBe(9);
    expectBootstrapInvalidated(inactiveRun.queryClient);
  });
});
