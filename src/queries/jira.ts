import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "./keys";

/**
 * JIRA read queries. All are best-effort (no `meta.surfaceErrors`) — the board view
 * soft-fails and surfaces guidance through its own status panel, matching the
 * pre-migration behavior. Connection status loads on mount; the project list, the
 * board, and the project status set load only when their `enabled` gate is met.
 */

export function useJiraStatusQuery() {
  return useQuery({
    queryKey: queryKeys.jira.status(),
    queryFn: () => api.jiraStatus(),
    staleTime: 5 * 60_000,
  });
}

export function useJiraRestStatusQuery() {
  return useQuery({
    queryKey: queryKeys.jira.restStatus(),
    queryFn: () => api.jiraRestStatus(),
    staleTime: 5 * 60_000,
  });
}

export function useJiraProjectsQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jira.projects(),
    queryFn: () => api.jiraListProjects(),
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useJiraProjectStatusesQuery(project: string | null, enabled: boolean) {
  const shouldLoad = enabled && project != null;
  return useQuery({
    queryKey: queryKeys.jira.projectStatuses(project),
    queryFn: shouldLoad ? () => api.jiraProjectStatuses(project) : skipToken,
    staleTime: 15 * 60_000,
  });
}

export function useJiraBoardQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jira.board(),
    queryFn: () => api.jiraSearchBoard(),
    enabled,
    staleTime: 30_000,
  });
}
