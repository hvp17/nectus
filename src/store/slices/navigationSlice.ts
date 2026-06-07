import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";

/** The top-level routed views (mirrors the old `useApp.currentView` union). */
export type AppView = "mission" | "board" | "workspace" | "settings" | "reviews" | "jira";

export interface NavigationSlice {
  currentView: AppView;
  /** The FOCUSED workspace (drives the workspace board), not a global filter. */
  activeWorkspaceId?: number;
  setCurrentView: (view: AppView) => void;
  setActiveWorkspaceId: (id: number | undefined) => void;
  /** Focus a workspace's aggregated board: set focus + clear selection + route to it. */
  openWorkspaceBoard: (workspaceId: number) => void;
}

export const createNavigationSlice: StateCreator<AppState, [], [], NavigationSlice> = (set) => ({
  currentView: "mission",
  activeWorkspaceId: undefined,
  setCurrentView: (view) => set({ currentView: view }),
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  openWorkspaceBoard: (workspaceId) =>
    set({
      activeWorkspaceId: workspaceId,
      selectedRepoId: undefined,
      selectedTaskId: undefined,
      currentView: "workspace",
    }),
});
