import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../api";
import { toSettingsInput } from "../components/settings/profileDrafts";
import { syncSelectedWorkItem } from "../lib/jira";
import { useGuardedAction } from "./useGuardedAction";
import { useJira } from "./useJira";
import type { AppSettings, JiraWorkItem } from "../types";

interface UseJiraBoardViewArgs {
  /** Whether the JIRA board view is active (gates the board/project loads). */
  active: boolean;
  settings: AppSettings | undefined;
  setSettings: Dispatch<SetStateAction<AppSettings | undefined>>;
  setMessage: (message: string | null) => void;
}

/**
 * Owns the JIRA board-view orchestration: the `useJira` data hook plus the
 * docked work-item panel (selected item kept in lockstep with the board, the
 * create/view panel mutual-exclusion), the structured board-config writes, and
 * the optional REST token connect/disconnect (which re-reads settings so a later
 * save can't clobber the stored account). Lifted out of `useApp` so that hook
 * stops mixing in JIRA board concerns. Task-from-story creation stays in `useApp`
 * because it drives the create-task form.
 */
export function useJiraBoardView({ active, settings, setSettings, setMessage }: UseJiraBoardViewArgs) {
  const jira = useJira({
    active,
    configured: Boolean(settings?.jiraBoardProject),
    project: settings?.jiraBoardProject ?? null,
    statusFilter: settings?.jiraFilterStatuses ?? [],
    setMessage,
  });

  const [selectedItem, setSelectedItem] = useState<JiraWorkItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const run = useGuardedAction(setMessage);
  const {
    clearApiToken,
    create: createJiraWorkItem,
    refresh: refreshJira,
    setApiToken,
  } = jira;

  // Keep the docked work-item panel in lockstep with the board: a panel-driven
  // transition/assign mutates `jira.items` and refreshes, so re-read the selected
  // item from the fresh results (a just-created item not yet on the board is kept).
  useEffect(() => {
    setSelectedItem((current) => syncSelectedWorkItem(current, jira.items));
  }, [jira.items]);

  const setBoardConfig = useCallback(
    (partial: {
      project?: string | null;
      myIssues?: boolean;
      unresolved?: boolean;
      currentSprint?: boolean;
      statuses?: string[];
      epic?: string | null;
    }) =>
      run(async () => {
        if (!settings) return;
        // Switching projects clears the epic filter (an epic key belongs to one
        // project), unless the same change explicitly sets a new epic.
        const epic =
          partial.epic !== undefined
            ? partial.epic
            : partial.project !== undefined && partial.project !== settings.jiraBoardProject
              ? null
              : settings.jiraFilterEpic ?? null;
        const updated = await api.updateAppSettings({
          ...toSettingsInput(settings),
          jiraBoardProject:
            partial.project !== undefined ? partial.project : settings.jiraBoardProject ?? null,
          jiraFilterMyIssues: partial.myIssues ?? settings.jiraFilterMyIssues,
          jiraFilterUnresolved: partial.unresolved ?? settings.jiraFilterUnresolved,
          jiraFilterCurrentSprint: partial.currentSprint ?? settings.jiraFilterCurrentSprint,
          jiraFilterStatuses: partial.statuses ?? settings.jiraFilterStatuses,
          jiraFilterEpic: epic,
        });
        setSettings(updated);
        await refreshJira();
      }),
    [refreshJira, run, setSettings, settings],
  );

  // Connecting/disconnecting a token writes jira_site_url / jira_rest_email
  // server-side. Re-read settings so the local copy stays fresh — otherwise a
  // later settings or board-config save would re-send the stale jira_site_url and
  // clobber the REST account, orphaning the Keychain token.
  const saveToken = useCallback(
    async (site: string, email: string, token: string) => {
      const status = await setApiToken(site, email, token);
      setSettings(await api.getAppSettings());
      return status;
    },
    [setApiToken, setSettings],
  );

  const disconnect = useCallback(async () => {
    await clearApiToken();
    setSettings(await api.getAppSettings());
  }, [clearApiToken, setSettings]);

  // The create panel and the view panel share the board's dock slot, so opening
  // one closes the other.
  const openItem = useCallback((item: JiraWorkItem) => {
    setCreateOpen(false);
    setSelectedItem(item);
  }, []);

  const openCreate = useCallback(() => {
    setSelectedItem(null);
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(() => setCreateOpen(false), []);

  // Create a work item, then (on success) swap the create panel for the new
  // item's view panel — where "Create task & start" can spin up an agent on it.
  const createWorkItem = useCallback(
    async (input: {
      project: string;
      issueType: string;
      summary: string;
      description?: string;
      assignee?: string;
      labels?: string;
    }) => {
      const item = await createJiraWorkItem(input);
      if (item) {
        setCreateOpen(false);
        setSelectedItem(item);
      }
      return item;
    },
    [createJiraWorkItem],
  );

  return {
    jira,
    selectedItem,
    setSelectedItem,
    createOpen,
    openItem,
    openCreate,
    closeCreate,
    createWorkItem,
    setBoardConfig,
    saveToken,
    disconnect,
  };
}
