import type { Dispatch, SetStateAction } from "react";
import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";
import { applyUpdate } from "../setState";

/**
 * What's currently selected in the shell — the focused repo, task, and agent.
 * Setters accept `SetStateAction` so they are drop-in replacements for the
 * `useState` setters the consuming hooks were written against (some pass updaters,
 * e.g. `setSelectedTaskId(cur => ...)`).
 */
export interface SelectionSlice {
  selectedRepoId?: number;
  selectedTaskId?: number;
  selectedAgentProfileId?: number;
  setSelectedRepoId: Dispatch<SetStateAction<number | undefined>>;
  setSelectedTaskId: Dispatch<SetStateAction<number | undefined>>;
  setSelectedAgentProfileId: Dispatch<SetStateAction<number | undefined>>;
}

export const createSelectionSlice: StateCreator<AppState, [], [], SelectionSlice> = (set) => ({
  selectedRepoId: undefined,
  selectedTaskId: undefined,
  selectedAgentProfileId: undefined,
  setSelectedRepoId: (value) => set((s) => ({ selectedRepoId: applyUpdate(value, s.selectedRepoId) })),
  setSelectedTaskId: (value) => set((s) => ({ selectedTaskId: applyUpdate(value, s.selectedTaskId) })),
  setSelectedAgentProfileId: (value) =>
    set((s) => ({ selectedAgentProfileId: applyUpdate(value, s.selectedAgentProfileId) })),
});
