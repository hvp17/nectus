import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { JiraSprintLane, JiraStatusDef, JiraWorkItem } from "../types";
import { queryKeys } from "./keys";
import { useOptionalQuery } from "./optional";

/**
 * JIRA read queries. All are best-effort (no `meta.surfaceErrors`) — the board view
 * soft-fails and surfaces guidance through its own status panel, matching the
 * pre-migration behavior. Connection status loads on mount; the project list, the
 * board, and the project status set load only when their `enabled` gate is met.
 */

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
  return useOptionalQuery<JiraStatusDef[]>(
    shouldLoad
      ? {
          queryKey: queryKeys.jira.projectStatuses(project),
          queryFn: () => api.jiraProjectStatuses(project),
          staleTime: 15 * 60_000,
        }
      : null,
  );
}

export function useJiraBoardQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.jira.board(),
    queryFn: () => api.jiraSearchBoard(),
    enabled,
    staleTime: 30_000,
  });
}

export function useJiraEpicsQuery(project: string | null, enabled: boolean) {
  const shouldLoad = enabled && project != null;
  return useOptionalQuery<JiraWorkItem[]>(
    shouldLoad
      ? {
          queryKey: queryKeys.jira.epics(project),
          queryFn: () => api.jiraListEpics(project),
          staleTime: 10 * 60_000,
        }
      : null,
  );
}

export function useJiraSprintBoardQuery(project: string | null, enabled: boolean) {
  const shouldLoad = enabled && project != null;
  return useOptionalQuery<JiraSprintLane[]>(
    shouldLoad
      ? {
          queryKey: queryKeys.jira.sprintBoard(project),
          queryFn: () => api.jiraSprintBoard(project),
          staleTime: 30_000,
        }
      : null,
  );
}
