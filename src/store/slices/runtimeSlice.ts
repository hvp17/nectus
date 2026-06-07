import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";

/**
 * Transient runtime flags: the global `busy` flag (set while a guarded command is
 * in flight) and the set of tasks whose deletion is in progress. (Initial-load
 * `loading` is derived from the bootstrap queries' `isLoading` in the views, not
 * stored here.)
 */
export interface RuntimeSlice {
  busy: boolean;
  deletingTaskIds: ReadonlySet<number>;
  setBusy: (busy: boolean) => void;
  setTaskDeleting: (taskId: number, deleting: boolean) => void;
}

export const createRuntimeSlice: StateCreator<AppState, [], [], RuntimeSlice> = (set) => ({
  busy: false,
  deletingTaskIds: new Set<number>(),
  setBusy: (busy) => set({ busy }),
  setTaskDeleting: (taskId, deleting) =>
    set((state) => {
      const next = new Set(state.deletingTaskIds);
      if (deleting) next.add(taskId);
      else next.delete(taskId);
      return { deletingTaskIds: next };
    }),
});
