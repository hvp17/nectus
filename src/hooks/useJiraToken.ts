import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import type { AppSettings, JiraRestStatus } from "../types";

/**
 * The optional JIRA REST API-token connect/disconnect, isolated from the board so
 * the Settings card can own it without the board's data hook. Each action writes
 * the REST-status cache and re-reads settings (the backend stores the non-secret
 * site/email there, so a later save can't clobber the connected account).
 */
export function useJiraToken() {
  const queryClient = useQueryClient();
  const setSettings = useMemo(
    () => makeCacheSetter<AppSettings | undefined>(queryClient, queryKeys.settings()),
    [queryClient],
  );

  const setApiToken = useCallback(
    async (site: string, email: string, token: string): Promise<JiraRestStatus> => {
      const status = await api.setJiraApiToken(site, email, token);
      queryClient.setQueryData(queryKeys.jira.restStatus(), status);
      setSettings(await api.getAppSettings());
      return status;
    },
    [queryClient, setSettings],
  );

  const clearApiToken = useCallback(async () => {
    await api.clearJiraApiToken();
    await queryClient.invalidateQueries({ queryKey: queryKeys.jira.restStatus() });
    setSettings(await api.getAppSettings());
  }, [queryClient, setSettings]);

  return { setApiToken, clearApiToken };
}
