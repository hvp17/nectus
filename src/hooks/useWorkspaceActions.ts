import { api } from "../api";
import { useRefreshData } from "../queries/core";
import { useGuardedAction } from "./useGuardedAction";
import { useAppStore } from "../store/appStore";

/**
 * Workspace create/update/delete — self-sufficient (reads/writes the store + the
 * query cache via refresh). useShellBootstrap's getState() guard keeps the
 * bootstrap "drop deleted workspace" effect from fighting a just-created focus.
 */
export function useWorkspaceActions() {
  const setMessage = useAppStore((s) => s.setMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const run = useGuardedAction(setMessage, setBusy);
  const refresh = useRefreshData();

  const createWorkspace = (name: string, repoIds: number[]) =>
    run(
      async () => {
        const workspace = await api.createWorkspace(name, repoIds);
        await refresh();
        setActiveWorkspaceId(workspace.id);
        setMessage(`Workspace: Created ${workspace.name}`);
        return workspace;
      },
      { busy: true, rethrow: true },
    );

  const updateWorkspace = (id: number, name: string, repoIds: number[]) =>
    run(
      async () => {
        const workspace = await api.updateWorkspace(id, name, repoIds);
        await refresh();
        setMessage(`Workspace: Saved ${workspace.name}`);
        return workspace;
      },
      { busy: true, rethrow: true },
    );

  const deleteWorkspace = (id: number) =>
    run(
      async () => {
        await api.deleteWorkspace(id);
        if (useAppStore.getState().activeWorkspaceId === id) setActiveWorkspaceId(undefined);
        await refresh();
        setMessage("Workspace: Deleted");
      },
      { busy: true, rethrow: true },
    );

  return { createWorkspace, updateWorkspace, deleteWorkspace };
}
