import { useCallback } from "react";
import { useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import type { Repo, Workspace } from "../types";

/** Optimistically flip `collapsed` on the cached row, persist, revert on failure. */
function setCollapsed<T extends { id: number; collapsed: boolean }>(
  queryClient: QueryClient,
  key: QueryKey,
  persist: (id: number, collapsed: boolean) => Promise<void>,
  id: number,
  collapsed: boolean,
) {
  const write = (value: boolean) =>
    queryClient.setQueryData<T[]>(key, (prev) =>
      prev?.map((row) => (row.id === id ? { ...row, collapsed: value } : row)),
    );
  write(collapsed);
  void persist(id, collapsed).catch(() => write(!collapsed));
}

/**
 * Toggle the sidebar fold of a project's / workspace's nested in-flight agent
 * list. The fold is a pure UI preference, so it writes the repos/workspaces query
 * cache optimistically (instant fold, no full refetch) and persists via the
 * backend, reverting the cache if that write fails so it never drifts from SQLite.
 */
export function useSidebarCollapse() {
  const queryClient = useQueryClient();

  const setRepoCollapsed = useCallback(
    (id: number, collapsed: boolean) =>
      setCollapsed<Repo>(queryClient, queryKeys.repos(), api.setRepoCollapsed, id, collapsed),
    [queryClient],
  );

  const setWorkspaceCollapsed = useCallback(
    (id: number, collapsed: boolean) =>
      setCollapsed<Workspace>(
        queryClient,
        queryKeys.workspaces(),
        api.setWorkspaceCollapsed,
        id,
        collapsed,
      ),
    [queryClient],
  );

  return { setRepoCollapsed, setWorkspaceCollapsed };
}
