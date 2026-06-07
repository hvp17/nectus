import type { Dispatch, SetStateAction } from "react";
import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";
import { applyUpdate } from "../setState";
import type { TaskAttention } from "../../sessionAttention";
import { isBrowserPreview, seedAttention, seedLiveLines } from "../../lib/browserSeed";

/**
 * Live, push-driven runtime state fed by the Tauri session events: the latest
 * activity line per task and the cross-project attention list. This is ephemeral
 * state rebuilt from events (not server state), so it lives in the store rather
 * than the query cache. Setters accept `SetStateAction` so the event hooks, which
 * call the updater form (`setTaskAttention(cur => ...)`), drop in unchanged.
 */
export interface SessionRuntimeSlice {
  liveLines: Record<number, string>;
  taskAttention: TaskAttention[];
  setLiveLines: Dispatch<SetStateAction<Record<number, string>>>;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
}

export const createSessionRuntimeSlice: StateCreator<AppState, [], [], SessionRuntimeSlice> = (set) => ({
  liveLines: isBrowserPreview ? seedLiveLines : {},
  taskAttention: isBrowserPreview ? seedAttention : [],
  setLiveLines: (value) => set((s) => ({ liveLines: applyUpdate(value, s.liveLines) })),
  setTaskAttention: (value) => set((s) => ({ taskAttention: applyUpdate(value, s.taskAttention) })),
});
