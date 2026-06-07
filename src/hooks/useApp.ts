import { useCallback, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import {
  useReposQuery,
  useWorkspacesQuery,
  useAgentProfilesQuery,
  useSettingsQuery,
  useTasksQuery,
} from "../queries/core";
import { queryKeys } from "../queries/keys";
import { useAppStore } from "../store/appStore";
import { getAttentionCounts } from "../sessionAttention";
import { useGuardedAction } from "./useGuardedAction";
import type { AgentProfile, Repo, TaskSummary, Workspace } from "../types";

// Stable empty fallbacks so a still-loading query yields the same array reference
// every render (keeps the downstream `useMemo`s from recomputing during boot).
const EMPTY_REPOS: Repo[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_PROFILES: AgentProfile[] = [];
const EMPTY_TASKS: TaskSummary[] = [];

/**
 * The app shell hook: bootstrap server reads (TanStack Query), the shell's
 * navigation/selection/runtime state (Zustand store), the derived task lists, the
 * boot-time default-selection, and the two shell actions (`addProject`, `refresh`).
 *
 * Everything domain-specific now lives in its own view/overlay + focused hooks
 * (PR reviews, settings, the composer, the JIRA board, the open-task workspace,
 * task/workspace actions), and all Tauri events flow through `useEventBridge`. This
 * is the thin composition that remains of the former `useApp` god-hook.
 */
export function useApp() {
  const queryClient = useQueryClient();

  const reposQuery = useReposQuery();
  const repos = reposQuery.data ?? EMPTY_REPOS;
  const workspacesQuery = useWorkspacesQuery();
  const workspaces = workspacesQuery.data ?? EMPTY_WORKSPACES;
  const agentProfilesQuery = useAgentProfilesQuery();
  const agentProfiles = agentProfilesQuery.data ?? EMPTY_PROFILES;
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data;
  const tasksQuery = useTasksQuery();
  const tasks = tasksQuery.data ?? EMPTY_TASKS;

  // ---- Shell UI state (Zustand) --------------------------------------------
  const currentView = useAppStore((s) => s.currentView);
  const setCurrentView = useAppStore((s) => s.setCurrentView);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useAppStore((s) => s.setActiveWorkspaceId);
  const openWorkspaceBoard = useAppStore((s) => s.openWorkspaceBoard);
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const setSelectedRepoId = useAppStore((s) => s.setSelectedRepoId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const selectedAgentProfileId = useAppStore((s) => s.selectedAgentProfileId);
  const setSelectedAgentProfileId = useAppStore((s) => s.setSelectedAgentProfileId);
  const message = useAppStore((s) => s.message);
  const setMessage = useAppStore((s) => s.setMessage);
  const taskToast = useAppStore((s) => s.taskToast);
  const setTaskToast = useAppStore((s) => s.setTaskToast);
  const busy = useAppStore((s) => s.busy);
  const setBusy = useAppStore((s) => s.setBusy);
  const taskAttention = useAppStore((s) => s.taskAttention);
  const liveLines = useAppStore((s) => s.liveLines);
  const deletingTaskIds = useAppStore((s) => s.deletingTaskIds);

  const loading =
    reposQuery.isLoading ||
    workspacesQuery.isLoading ||
    agentProfilesQuery.isLoading ||
    settingsQuery.isLoading ||
    tasksQuery.isLoading;

  const run = useGuardedAction(setMessage, setBusy);

  // Refs mirror the selection so the boot-time default-selection effects below can
  // run order-independently (read the freshest value without a render dependency).
  const selectedRepoIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);
  const activeWorkspaceIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);
  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);
  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  // ---- Derived shell data ---------------------------------------------------
  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);
  // `activeWorkspace` is the FOCUSED workspace (the one whose board is open).
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  // The focused workspace's repos, offered as the composer's cross-repo multi-select.
  const activeWorkspaceRepos = useMemo(
    () => (activeWorkspace ? repos.filter((repo) => activeWorkspace.repoIds.includes(repo.id)) : EMPTY_REPOS),
    [activeWorkspace, repos],
  );
  const selectedTask = useMemo(() => tasks.find((task) => task.id === selectedTaskId), [tasks, selectedTaskId]);

  const counts = useMemo(() => {
    const attentionCounts = getAttentionCounts(taskAttention);
    return {
      active: tasks.filter((task) => task.activeSessionId).length,
      dirty: tasks.filter((task) => task.isDirty).length,
      review: tasks.filter((task) => task.status === "review").length,
      needsInput: attentionCounts.needsInput,
      finished: attentionCounts.finished,
    };
  }, [taskAttention, tasks]);

  // `refresh` (re)validates the bootstrap query cache; a `preferredRepoId` wins
  // immediately (e.g. right after adding a project) before the refetch lands.
  const refresh = useCallback(
    async (preferredRepoId?: number) => {
      if (preferredRepoId !== undefined) {
        selectedRepoIdRef.current = preferredRepoId;
        setSelectedRepoId(preferredRepoId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.repos() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agentProfiles() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.settings() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks() }),
      ]);
    },
    [queryClient, setSelectedRepoId],
  );

  // Boot-time default selection (was `refresh`'s job): default agent, default repo,
  // and dropping a focused workspace that was deleted elsewhere.
  useEffect(() => {
    if (selectedAgentProfileIdRef.current) return;
    const next = settings?.defaultAgentProfileId ?? agentProfiles[0]?.id;
    if (next !== undefined) {
      selectedAgentProfileIdRef.current = next;
      setSelectedAgentProfileId(next);
    }
  }, [settings, agentProfiles, setSelectedAgentProfileId]);

  useEffect(() => {
    if (selectedRepoIdRef.current !== undefined) return;
    if (repos[0]) {
      selectedRepoIdRef.current = repos[0].id;
      setSelectedRepoId(repos[0].id);
    }
  }, [repos, setSelectedRepoId]);

  useEffect(() => {
    if (
      activeWorkspaceIdRef.current &&
      !workspaces.some((workspace) => workspace.id === activeWorkspaceIdRef.current)
    ) {
      activeWorkspaceIdRef.current = undefined;
      setActiveWorkspaceId(undefined);
    }
  }, [workspaces, setActiveWorkspaceId]);

  const addProject = () =>
    run(
      async () => {
        const selected = await api.pickRepositoryFolder();
        if (!selected) return;
        const repo = await api.addRepo(selected);
        setSelectedRepoId(repo.id);
        await refresh(repo.id);
        setMessage(`Added ${repo.name}`);
      },
      { busy: true },
    );

  return {
    repos,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    activeWorkspaceRepos,
    openWorkspaceBoard,
    tasks,
    agentProfiles,
    settings,
    currentView,
    setCurrentView,
    selectedRepoId,
    setSelectedRepoId,
    selectedTaskId,
    setSelectedTaskId,
    selectedRepo,
    selectedTask,
    taskAttention,
    liveLines,
    counts,
    message,
    setMessage,
    taskToast,
    setTaskToast,
    busy,
    deletingTaskIds,
    loading,
    refresh,
    addProject,
  };
}
