import { create } from "zustand";
import { createNavigationSlice, type NavigationSlice } from "./slices/navigationSlice";
import { createSelectionSlice, type SelectionSlice } from "./slices/selectionSlice";
import { createComposerSlice, type ComposerSlice } from "./slices/composerSlice";
import { createRuntimeSlice, type RuntimeSlice } from "./slices/runtimeSlice";
import { createSessionRuntimeSlice, type SessionRuntimeSlice } from "./slices/sessionRuntimeSlice";
import { createNotificationSlice, type NotificationSlice } from "./slices/notificationSlice";

/**
 * The single app-wide UI/runtime store. It owns everything that is NOT server
 * state: navigation, selection, the global busy flag, the push-driven session
 * runtime (`liveLines`/`taskAttention`), and the message/toast channel. Server data
 * lives in the TanStack Query cache (`src/queries/*`); this store and that cache
 * are the two halves that replaced the state ownership of the old `useApp` hook.
 *
 * Composed from concern-split slices (one `StateCreator` each) that all share this
 * one store, so a slice action can update fields owned by another slice (e.g.
 * `openWorkspaceBoard` clears the selection).
 */
export type AppState = NavigationSlice &
  SelectionSlice &
  ComposerSlice &
  RuntimeSlice &
  SessionRuntimeSlice &
  NotificationSlice;

export const useAppStore = create<AppState>()((...args) => ({
  ...createNavigationSlice(...args),
  ...createSelectionSlice(...args),
  ...createComposerSlice(...args),
  ...createRuntimeSlice(...args),
  ...createSessionRuntimeSlice(...args),
  ...createNotificationSlice(...args),
}));
