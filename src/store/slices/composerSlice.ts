import type { Dispatch, SetStateAction } from "react";
import type { StateCreator } from "zustand";
import type { AppState } from "../appStore";
import { applyUpdate } from "../setState";
import { createBranchIdentifier, type PendingJiraLink } from "../../lib/composerForm";

/**
 * The New Task composer draft, now store-owned so the open-trigger (rail / board),
 * the composer overlay, and JIRA's "create task from story" all share one draft.
 * The random `newTaskBranchIdentifier` is regenerated on every reset so each
 * composer session suggests a distinct branch name. Setters accept `SetStateAction`
 * so they drop into the composer component's `useState`-shaped props.
 */
export interface ComposerSlice {
  createTaskOpen: boolean;
  newTaskTitle: string;
  newTaskPrompt: string;
  newTaskBranchName: string;
  newTaskBranchIdentifier: string;
  newTaskHasWorktree: boolean;
  newTaskAgentProfileId?: number;
  newTaskRepoId?: number;
  /** Repos chosen for a cross-repo task in Workspace mode. Primary first. */
  newTaskRepoIds: number[];
  /** Workspace the composer targets; undefined = single-repo (Project) mode. */
  newTaskWorkspaceId?: number;
  pendingJiraLink: PendingJiraLink | null;
  setCreateTaskOpen: (open: boolean) => void;
  setNewTaskTitle: Dispatch<SetStateAction<string>>;
  setNewTaskPrompt: Dispatch<SetStateAction<string>>;
  setNewTaskBranchName: Dispatch<SetStateAction<string>>;
  setNewTaskHasWorktree: Dispatch<SetStateAction<boolean>>;
  setNewTaskAgentProfileId: Dispatch<SetStateAction<number | undefined>>;
  setNewTaskRepoId: Dispatch<SetStateAction<number | undefined>>;
  setNewTaskRepoIds: Dispatch<SetStateAction<number[]>>;
  setNewTaskWorkspaceId: Dispatch<SetStateAction<number | undefined>>;
  setPendingJiraLink: (link: PendingJiraLink | null) => void;
  /** Reset the draft to defaults (keeping the composer open). Selects `agentProfileId`. */
  resetComposer: (agentProfileId?: number) => void;
  /** Close the composer and reset the draft in one step. */
  closeComposer: (agentProfileId?: number) => void;
}

const freshDraft = (agentProfileId?: number) => ({
  newTaskTitle: "",
  newTaskPrompt: "",
  newTaskBranchName: "",
  newTaskBranchIdentifier: createBranchIdentifier(),
  newTaskHasWorktree: false,
  newTaskAgentProfileId: agentProfileId,
  newTaskRepoId: undefined,
  newTaskRepoIds: [] as number[],
  newTaskWorkspaceId: undefined,
  pendingJiraLink: null,
});

export const createComposerSlice: StateCreator<AppState, [], [], ComposerSlice> = (set) => ({
  createTaskOpen: false,
  ...freshDraft(undefined),
  setCreateTaskOpen: (open) => set({ createTaskOpen: open }),
  setNewTaskTitle: (value) => set((s) => ({ newTaskTitle: applyUpdate(value, s.newTaskTitle) })),
  setNewTaskPrompt: (value) => set((s) => ({ newTaskPrompt: applyUpdate(value, s.newTaskPrompt) })),
  setNewTaskBranchName: (value) => set((s) => ({ newTaskBranchName: applyUpdate(value, s.newTaskBranchName) })),
  setNewTaskHasWorktree: (value) => set((s) => ({ newTaskHasWorktree: applyUpdate(value, s.newTaskHasWorktree) })),
  setNewTaskAgentProfileId: (value) =>
    set((s) => ({ newTaskAgentProfileId: applyUpdate(value, s.newTaskAgentProfileId) })),
  setNewTaskRepoId: (value) => set((s) => ({ newTaskRepoId: applyUpdate(value, s.newTaskRepoId) })),
  setNewTaskRepoIds: (value) => set((s) => ({ newTaskRepoIds: applyUpdate(value, s.newTaskRepoIds) })),
  setNewTaskWorkspaceId: (value) =>
    set((s) => ({ newTaskWorkspaceId: applyUpdate(value, s.newTaskWorkspaceId) })),
  setPendingJiraLink: (link) => set({ pendingJiraLink: link }),
  resetComposer: (agentProfileId) => set(freshDraft(agentProfileId)),
  closeComposer: (agentProfileId) => set({ createTaskOpen: false, ...freshDraft(agentProfileId) }),
});
