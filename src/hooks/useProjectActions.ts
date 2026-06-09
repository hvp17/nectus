import { useCallback } from "react";
import { api } from "../api";
import { useRefreshData } from "../queries/core";
import { useGuardedAction } from "./useGuardedAction";
import { useAppStore } from "../store/appStore";

/** Add an existing local git repo as a project, select it, and refresh. */
export function useProjectActions() {
  const setMessage = useAppStore((s) => s.setMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const setSelectedRepoId = useAppStore((s) => s.setSelectedRepoId);
  const run = useGuardedAction(setMessage, setBusy);
  const refresh = useRefreshData();

  const addProject = useCallback(
    () =>
      run(
        async () => {
          const selected = await api.pickRepositoryFolder();
          if (!selected) return;
          const repo = await api.addRepo(selected);
          // Select the new repo before the refetch lands so the default-repo effect
          // doesn't override it.
          setSelectedRepoId(repo.id);
          await refresh();
          setMessage(`Added ${repo.name}`);
        },
        { busy: true },
      ),
    [refresh, run, setMessage, setSelectedRepoId],
  );

  return { addProject };
}
