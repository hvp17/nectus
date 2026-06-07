import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";

/**
 * The global busy flag — set while a guarded command (`run`) is in flight so the
 * shell can disable actions. (Initial-load `loading` is derived from the bootstrap
 * queries' `isLoading` in `useApp`, not stored here.)
 */
export interface RuntimeSlice {
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export const createRuntimeSlice: StateCreator<AppState, [], [], RuntimeSlice> = (set) => ({
  busy: false,
  setBusy: (busy) => set({ busy }),
});
