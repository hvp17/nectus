import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import {
  useJiraStatusQuery,
  useJiraRestStatusQuery,
  useJiraProjectsQuery,
  useJiraProjectStatusesQuery,
  useJiraBoardQuery,
} from "../queries/jira";
import { isCliConnected } from "../lib/connection";
import type {
  JiraProject,
  JiraRestStatus,
  JiraStatusCategory,
  JiraStatusDef,
  JiraWorkItem,
} from "../types";

export interface JiraColumn {
  statusName: string;
  category: JiraStatusCategory;
  items: JiraWorkItem[];
}

const CATEGORY_ORDER: Record<JiraStatusCategory, number> = {
  to_do: 0,
  in_progress: 1,
  done: 2,
  unknown: 3,
};

/**
 * Build the board columns. With a connected REST token, `projectStatuses` supplies
 * the full custom-workflow status set so the column skeleton renders every status
 * (including empty ones), narrowed to `statusFilter` when one is active. Without
 * REST, columns are auto-derived from the statuses present in the results (acli
 * exposes no canonical status list), narrowed client-side to `statusFilter`.
 * Either way, columns are ordered by JIRA status category then status name.
 */
export function deriveColumns(
  items: JiraWorkItem[],
  projectStatuses: JiraStatusDef[] = [],
  statusFilter: string[] = [],
): JiraColumn[] {
  const itemsByStatus = new Map<string, JiraWorkItem[]>();
  for (const item of items) {
    const bucket = itemsByStatus.get(item.statusName);
    if (bucket) bucket.push(item);
    else itemsByStatus.set(item.statusName, [item]);
  }

  const filter = new Set(statusFilter);
  const allowed = (statusName: string) => filter.size === 0 || filter.has(statusName);
  let columns: JiraColumn[];
  if (projectStatuses.length > 0) {
    const skeleton = projectStatuses.filter((status) => allowed(status.name));
    columns = skeleton.map((status) => ({
      statusName: status.name,
      category: status.category,
      items: itemsByStatus.get(status.name) ?? [],
    }));
    // Surface any item whose status isn't in the project skeleton (safety net).
    for (const [statusName, bucket] of itemsByStatus) {
      if (!skeleton.some((status) => status.name === statusName) && allowed(statusName)) {
        columns.push({ statusName, category: bucket[0].statusCategory, items: bucket });
      }
    }
  } else {
    columns = [...itemsByStatus.entries()]
      .filter(([statusName]) => allowed(statusName))
      .map(([statusName, bucket]) => ({
        statusName,
        category: bucket[0].statusCategory,
        items: bucket,
      }));
  }

  return columns.sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return byCategory !== 0 ? byCategory : a.statusName.localeCompare(b.statusName);
  });
}

interface UseJiraInput {
  active: boolean;
  /** Whether a board project has been chosen — the board only loads once it is. */
  configured: boolean;
  /** The configured board project key, used to load its REST status set. */
  project: string | null;
  /** Board status-filter selection; narrows the rendered columns. */
  statusFilter: string[];
  setMessage: (message: string | null) => void;
}

const EMPTY_PROJECTS: JiraProject[] = [];
const EMPTY_STATUSES: JiraStatusDef[] = [];
const EMPTY_ITEMS: JiraWorkItem[] = [];

/**
 * Owns JIRA connection state, the project list, and the board work items — backed
 * by TanStack Query. Connection status (acli + optional REST token) loads on mount;
 * the project list / project status set / board load only once their `enabled` gate
 * is met (view active, CLI connected, a project configured). The board transition
 * is an optimistic cache write with snapshot rollback; the board JQL is built
 * backend-side from the structured config, so no JQL is typed here.
 */
export function useJira({ active, configured, project, statusFilter, setMessage }: UseJiraInput) {
  const queryClient = useQueryClient();

  const jiraStatus = useJiraStatusQuery().data;
  const restStatus = useJiraRestStatusQuery().data;
  const ready = isCliConnected(jiraStatus);
  const restConnected = Boolean(restStatus?.connected);

  const projects = useJiraProjectsQuery(active && ready).data ?? EMPTY_PROJECTS;
  const projectStatuses =
    useJiraProjectStatusesQuery(project, active && ready && restConnected).data ?? EMPTY_STATUSES;
  const boardQuery = useJiraBoardQuery(active && ready && configured);
  const items = boardQuery.data ?? EMPTY_ITEMS;
  const loading = boardQuery.isLoading;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.jira.board() });
  }, [queryClient]);

  const transition = useCallback(
    async (item: JiraWorkItem, statusName: string) => {
      if (item.statusName === statusName) return;
      // Optimistic: snapshot the whole board, flip the card locally, then
      // re-hydrate from JIRA on success or restore the snapshot on failure.
      const key = queryKeys.jira.board();
      const previous = queryClient.getQueryData<JiraWorkItem[]>(key);
      queryClient.setQueryData<JiraWorkItem[]>(key, (current = []) =>
        current.map((it) => (it.key === item.key ? { ...it, statusName } : it)),
      );
      try {
        await api.jiraTransitionWorkItem(item.key, statusName);
        await refresh();
      } catch (error) {
        if (previous) queryClient.setQueryData(key, previous);
        setMessage(String(error));
      }
    },
    [queryClient, refresh, setMessage],
  );

  const assign = useCallback(
    async (key: string, assignee: string) => {
      try {
        await api.jiraAssignWorkItem(key, assignee);
        await refresh();
        setMessage(`Assigned ${key}`);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [refresh, setMessage],
  );

  const comment = useCallback(
    async (key: string, body: string) => {
      try {
        await api.jiraCommentWorkItem(key, body);
        await refresh();
        setMessage(`Comment added to ${key}`);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [refresh, setMessage],
  );

  /**
   * Create a work item in JIRA, then refresh the board. Returns the new item so the
   * caller can open it in the side panel; returns null on failure (error surfaced
   * via `setMessage`).
   */
  const create = useCallback(
    async (input: {
      project: string;
      issueType: string;
      summary: string;
      description?: string;
      assignee?: string;
      labels?: string;
    }): Promise<JiraWorkItem | null> => {
      try {
        const item = await api.jiraCreateWorkItem(input);
        await refresh();
        setMessage(`Created ${item.key}`);
        return item;
      } catch (error) {
        setMessage(String(error));
        return null;
      }
    },
    [refresh, setMessage],
  );

  /** Verify + store a REST API token, then refresh status. Returns the new status. */
  const setApiToken = useCallback(
    async (site: string, email: string, token: string): Promise<JiraRestStatus> => {
      const status = await api.setJiraApiToken(site, email, token);
      queryClient.setQueryData(queryKeys.jira.restStatus(), status);
      return status;
    },
    [queryClient],
  );

  const clearApiToken = useCallback(async () => {
    await api.clearJiraApiToken();
    await queryClient.invalidateQueries({ queryKey: queryKeys.jira.restStatus() });
  }, [queryClient]);

  const columns = deriveColumns(items, projectStatuses, statusFilter);

  return {
    jiraStatus,
    restStatus,
    restConnected,
    ready,
    projects,
    projectStatuses,
    items,
    columns,
    loading,
    refresh,
    transition,
    assign,
    comment,
    create,
    setApiToken,
    clearApiToken,
  };
}
