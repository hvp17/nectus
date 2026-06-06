import { useCallback, useState } from "react";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import type {
  JiraProject,
  JiraRestStatus,
  JiraStatus,
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

/**
 * Owns JIRA connection state, the project list, and the board work items.
 * Connection status loads once; the project list loads when the view is active and
 * `acli` is connected; the board (re)loads once a project is configured. The board
 * JQL is built backend-side from the structured config, so no JQL is typed here.
 */
export function useJira({ active, configured, project, statusFilter, setMessage }: UseJiraInput) {
  const [jiraStatus, setJiraStatus] = useState<JiraStatus>();
  const [restStatus, setRestStatus] = useState<JiraRestStatus>();
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectStatuses, setProjectStatuses] = useState<JiraStatusDef[]>([]);
  const [items, setItems] = useState<JiraWorkItem[]>([]);
  const [loading, setLoading] = useState(false);

  useAsyncEffect(async (alive) => {
    try {
      const status = await api.jiraStatus();
      if (alive()) setJiraStatus(status);
    } catch {
      if (alive()) {
        setJiraStatus({ installed: false, authenticated: false, account: null, site: null });
      }
    }
  }, []);

  const ready = Boolean(jiraStatus?.installed && jiraStatus?.authenticated);
  const restConnected = Boolean(restStatus?.connected);

  // Optional REST-token status: load it once the view is active and acli is
  // connected, and re-load after a token change.
  const refreshRestStatus = useCallback(async () => {
    try {
      setRestStatus(await api.jiraRestStatus());
    } catch {
      setRestStatus({ connected: false, site: null, email: null, error: null });
    }
  }, []);

  // Load once on mount, independent of the active view: Settings consumes the REST
  // status too, and a stored Keychain token is valid even when acli is down — so
  // gating this on the JIRA board being active would show a real token as
  // "Not connected" when Settings is opened first.
  useAsyncEffect(async (alive) => {
    try {
      const status = await api.jiraRestStatus();
      if (alive()) setRestStatus(status);
    } catch {
      if (alive()) setRestStatus({ connected: false, site: null, email: null, error: null });
    }
  }, []);

  // With a connected token, load the project's full custom-workflow status set so
  // the board can render every column (incl. empty) and the filter can offer them.
  useAsyncEffect(
    async (alive) => {
      if (!active || !ready || !restConnected || !project) {
        if (alive()) setProjectStatuses([]);
        return;
      }
      try {
        const defs = await api.jiraProjectStatuses(project);
        if (alive()) setProjectStatuses(defs);
      } catch (error) {
        if (alive()) {
          setProjectStatuses([]);
          setMessage(String(error));
        }
      }
    },
    [active, ready, restConnected, project, setMessage],
  );

  // Load the project picker options when the view is active and connected.
  useAsyncEffect(
    async (alive) => {
      if (!active || !ready) return;
      try {
        const list = await api.jiraListProjects();
        if (alive()) setProjects(list);
      } catch {
        // Soft-fail: the picker just stays empty; status guidance still shows.
      }
    },
    [active, ready],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.jiraSearchBoard());
    } catch (error) {
      setItems([]);
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [setMessage]);

  // Load the board whenever the view becomes active, the CLI is connected, and a
  // project has been chosen.
  useAsyncEffect(
    async (alive) => {
      if (!active || !ready || !configured || !alive()) return;
      await refresh();
    },
    [active, ready, configured, refresh],
  );

  const transition = useCallback(
    async (item: JiraWorkItem, statusName: string) => {
      if (item.statusName === statusName) return;
      // Optimistic: move the card locally, then revert if JIRA rejects the move.
      const previous = item.statusName;
      setItems((current) =>
        current.map((it) => (it.key === item.key ? { ...it, statusName } : it)),
      );
      try {
        await api.jiraTransitionWorkItem(item.key, statusName);
        await refresh();
      } catch (error) {
        setItems((current) =>
          current.map((it) => (it.key === item.key ? { ...it, statusName: previous } : it)),
        );
        setMessage(String(error));
      }
    },
    [refresh, setMessage],
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
        setMessage(`Comment added to ${key}`);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [setMessage],
  );

  /**
   * Create a work item in JIRA, then refresh the board. Returns the new item so the
   * caller can open it in the side panel; returns null on failure (error surfaced
   * via `setMessage`). The board only re-shows the new item when it was created in
   * the board's project, so opening the returned item is what guarantees it appears.
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
      setRestStatus(status);
      return status;
    },
    [],
  );

  const clearApiToken = useCallback(async () => {
    await api.clearJiraApiToken();
    await refreshRestStatus();
  }, [refreshRestStatus]);

  return {
    jiraStatus,
    restStatus,
    restConnected,
    ready,
    projects,
    projectStatuses,
    items,
    columns: deriveColumns(items, projectStatuses, statusFilter),
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
