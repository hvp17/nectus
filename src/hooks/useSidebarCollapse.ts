import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import type { Repo, Workspace } from "../types";

/**
 * Toggle the sidebar fold of a project's / workspace's nested in-flight agent
 * list. The fold is a pure UI preference, so it writes the repos/workspaces query
 * cache optimistically (instant fold, no full refetch) and persists via the
 * backend, reverting the cache if that write fails so it never drifts from SQLite.
 */
export function useSidebarCollapse() {
  const queryClient = useQueryClient();

  const setRepoCollapsed = useCallback(
    (id: number, collapsed: boolean) => {
      const write = (value: boolean) =>
        queryClient.setQueryData<Repo[]>(queryKeys.repos(), (prev) =>
          prev?.map((repo) => (repo.id === id ? { ...repo, collapsed: value } : repo)),
        );
      write(collapsed);
      void api.setRepoCollapsed(id, collapsed).catch(() => write(!collapsed));
    },
    [queryClient],
  );

  const setWorkspaceCollapsed = useCallback(
    (id: number, collapsed: boolean) => {
      const write = (value: boolean) =>
        queryClient.setQueryData<Workspace[]>(queryKeys.workspaces(), (prev) =>
          prev?.map((workspace) =>
            workspace.id === id ? { ...workspace, collapsed: value } : workspace,
          ),
        );
      write(collapsed);
      void api.setWorkspaceCollapsed(id, collapsed).catch(() => write(!collapsed));
    },
    [queryClient],
  );

  return { setRepoCollapsed, setWorkspaceCollapsed };
}
