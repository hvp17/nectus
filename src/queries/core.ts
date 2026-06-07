import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "./keys";

/**
 * The "bootstrap" reads — repos, workspaces, agent profiles, settings, and the
 * cross-project task list — that `useApp.refresh()` previously loaded by hand with
 * a shared loading flag and manual `setState`. Each is now a cache entry the rest
 * of the app (and the Tauri event handlers) reads and writes through TanStack Query.
 *
 * Reference data (repos, workspaces, profiles, settings) rarely changes outside an
 * explicit mutation, so it gets a long `staleTime`; invalidation after a write is
 * what refreshes it. The task list is mutated constantly by session events, so it
 * keeps the default short `staleTime` and is updated in place via `setQueryData`.
 *
 * All five carry `meta.surfaceErrors` so a failed load is reported to the user via
 * the QueryCache error handler (the old `refresh()` try/catch behavior). Best-effort
 * reads (PR status, JIRA board, …) deliberately omit it and stay silent.
 */

const REFERENCE_STALE_TIME = 60_000;
const SURFACE_ERRORS = { surfaceErrors: true } as const;

export function useReposQuery() {
  return useQuery({
    queryKey: queryKeys.repos(),
    queryFn: () => api.listRepos(),
    staleTime: REFERENCE_STALE_TIME,
    meta: SURFACE_ERRORS,
  });
}

export function useWorkspacesQuery() {
  return useQuery({
    queryKey: queryKeys.workspaces(),
    queryFn: () => api.listWorkspaces(),
    staleTime: REFERENCE_STALE_TIME,
    meta: SURFACE_ERRORS,
  });
}

export function useAgentProfilesQuery() {
  return useQuery({
    queryKey: queryKeys.agentProfiles(),
    queryFn: () => api.listAgentProfiles(),
    staleTime: REFERENCE_STALE_TIME,
    meta: SURFACE_ERRORS,
  });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api.getAppSettings(),
    staleTime: REFERENCE_STALE_TIME,
    meta: SURFACE_ERRORS,
  });
}

export function useTasksQuery() {
  return useQuery({
    queryKey: queryKeys.tasks(),
    queryFn: () => api.listTasks(),
    meta: SURFACE_ERRORS,
  });
}

/** Invalidate all bootstrap reads (the old `useApp.refresh()` with no preferred repo). */
export function useRefreshData() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.repos() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.agentProfiles() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.settings() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks() }),
    ]);
  }, [queryClient]);
}

/** True until every bootstrap read has resolved its first fetch. */
export function useBootstrapLoading() {
  // Call every hook unconditionally (no `||` short-circuit — that would change the
  // number of hooks between renders), then combine the booleans.
  const reposLoading = useReposQuery().isLoading;
  const workspacesLoading = useWorkspacesQuery().isLoading;
  const profilesLoading = useAgentProfilesQuery().isLoading;
  const settingsLoading = useSettingsQuery().isLoading;
  const tasksLoading = useTasksQuery().isLoading;
  return reposLoading || workspacesLoading || profilesLoading || settingsLoading || tasksLoading;
}
