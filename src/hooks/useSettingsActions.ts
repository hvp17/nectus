import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { useRefreshData } from "../queries/core";
import { useGuardedAction } from "./useGuardedAction";
import { useAppStore } from "../store/appStore";
import { resolveAgentProfileId } from "../lib/agentProfiles";
import { upsertById } from "../lib/listState";
import type { AgentProfile, AppSettings, AppSettingsInput } from "../types";

/** Save app settings / agent profiles — self-sufficient (cache + store + refresh). */
export function useSettingsActions() {
  const queryClient = useQueryClient();
  const setMessage = useAppStore((s) => s.setMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const setSelectedAgentProfileId = useAppStore((s) => s.setSelectedAgentProfileId);
  const run = useGuardedAction(setMessage, setBusy);
  const refresh = useRefreshData();
  const setSettings = useMemo(
    () => makeCacheSetter<AppSettings | undefined>(queryClient, queryKeys.settings()),
    [queryClient],
  );
  const setAgentProfiles = useMemo(
    () => makeCacheSetter<AgentProfile[]>(queryClient, queryKeys.agentProfiles()),
    [queryClient],
  );

  const saveAppSettings = useCallback(
    (input: AppSettingsInput) =>
      run(
        async () => {
          const updated = await api.updateAppSettings(input);
          setSettings(updated);
          // The default agent may have changed; reflect only a resolvable shell pick.
          const agentProfiles = queryClient.getQueryData<AgentProfile[]>(queryKeys.agentProfiles()) ?? [];
          setSelectedAgentProfileId(resolveAgentProfileId(agentProfiles, updated.defaultAgentProfileId));
          setMessage("Settings saved");
          await refresh();
          return updated;
        },
        { busy: true, rethrow: true },
      ),
    [queryClient, refresh, run, setMessage, setSelectedAgentProfileId, setSettings],
  );

  const saveAgentProfile = useCallback(
    (profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">) =>
      run(
        async () => {
          const saved = await api.upsertAgentProfile(profile);
          setAgentProfiles((current) => upsertById(current, saved));
          setMessage(`Saved ${saved.name}`);
          return saved;
        },
        { busy: true, rethrow: true },
      ),
    [run, setAgentProfiles, setMessage],
  );

  return { saveAppSettings, saveAgentProfile };
}
