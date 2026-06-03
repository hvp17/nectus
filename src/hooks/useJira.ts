import { useCallback, useState } from "react";
import { api } from "../api";
import { useAsyncEffect } from "./useAsyncEffect";
import type { JiraStatus, JiraStatusCategory, JiraWorkItem } from "../types";

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
 * Auto-derive board columns from the statuses present in the results, ordered by
 * JIRA status category (To Do -> In Progress -> Done) then status name. `acli`
 * exposes no canonical status list, so a status with zero items has no column by
 * design.
 */
export function deriveColumns(items: JiraWorkItem[]): JiraColumn[] {
  const byStatus = new Map<string, JiraColumn>();
  for (const item of items) {
    const existing = byStatus.get(item.statusName);
    if (existing) {
      existing.items.push(item);
    } else {
      byStatus.set(item.statusName, {
        statusName: item.statusName,
        category: item.statusCategory,
        items: [item],
      });
    }
  }
  return [...byStatus.values()].sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    return byCategory !== 0 ? byCategory : a.statusName.localeCompare(b.statusName);
  });
}

interface UseJiraInput {
  active: boolean;
  setMessage: (message: string | null) => void;
}

/**
 * Owns JIRA connection state and the board work items. Connection status loads
 * once; the board (re)loads whenever the JIRA view becomes active and `acli` is
 * connected. Mirrors `useGithub` in shape and soft-failure handling.
 */
export function useJira({ active, setMessage }: UseJiraInput) {
  const [jiraStatus, setJiraStatus] = useState<JiraStatus>();
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

  // Load the board whenever the view becomes active and the CLI is connected.
  useAsyncEffect(
    async (alive) => {
      if (!active || !ready || !alive()) return;
      await refresh();
    },
    [active, ready, refresh],
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

  return {
    jiraStatus,
    ready,
    items,
    columns: deriveColumns(items),
    loading,
    refresh,
    transition,
    assign,
    comment,
  };
}
