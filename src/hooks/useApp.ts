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
import { makeCacheSetter } from "../queries/cache";
import { useJiraStatusQuery } from "../queries/jira";
import { useAppStore } from "../store/appStore";
import { replaceById } from "../lib/listState";
import { isReviewLoopActive } from "../statusLabels";
import { useGuardedAction } from "./useGuardedAction";
import { clearTaskAttention, getAttentionCounts, getTaskAttention } from "../sessionAttention";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionAttentionControls } from "./useSessionAttentionControls";
// Session/review/PR Tauri events are handled by `useEventBridge` (mounted at the
// app root), so `useApp` no longer subscribes to them directly.
import { useGithub } from "./useGithub";
import { useTaskDeletion } from "./useTaskDeletion";
import { useTaskReviewLoop } from "./useTaskReviewLoop";
import type { AgentProfile, Repo, TaskStatus, TaskSummary, Workspace } from "../types";

const CREATE_PULL_REQUEST_PROMPT = `Create a pull request for this task. Use the current project/worktree branch. Before opening the PR, verify the work as appropriate for this repo, commit relevant changes with a Conventional Commit if needed, push the branch, create the PR against the remote default branch, and report the PR URL here.`;

// Stable empty fallbacks so a still-loading query yields the same array reference
// every render (keeps the downstream `useMemo`s from recomputing during boot).
const EMPTY_REPOS: Repo[] = [];
const EMPTY_WORKSPACES: Workspace[] = [];
const EMPTY_PROFILES: AgentProfile[] = [];
const EMPTY_TASKS: TaskSummary[] = [];

export function useApp() {
  const queryClient = useQueryClient();

  // Server reads flow through the TanStack Query cache. The `set*` shims write
  // straight into that cache so the existing mutation/event/refresh call sites keep
  // their `setState`-style signature unchanged (the façade pattern). Shims are
  // memoized on `[queryClient]` so their identity is stable for event-hook deps.
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
  const setTasks = useMemo(() => makeCacheSetter<TaskSummary[]>(queryClient, queryKeys.tasks()), [queryClient]);

  // ---- Shell UI state (Zustand) --------------------------------------------
  // Navigation, selection, the transient message channel, and the global busy flag
  // now live in the app store. The local names mirror the old `useState` bindings,
  // so the rest of this hook (and its public return shape) is unchanged. Store
  // setters are stable references, which keeps `run`/event-hook deps from churning.
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

  // Live session runtime (push-driven by the Tauri events) — owned by the store.
  const taskAttention = useAppStore((s) => s.taskAttention);
  const setTaskAttention = useAppStore((s) => s.setTaskAttention);
  const liveLines = useAppStore((s) => s.liveLines);
  // Initial bootstrap loading is derived from the bootstrap queries' first fetch.
  const loading =
    reposQuery.isLoading ||
    workspacesQuery.isLoading ||
    agentProfilesQuery.isLoading ||
    settingsQuery.isLoading ||
    tasksQuery.isLoading;
  const deletingTaskIds = useAppStore((s) => s.deletingTaskIds);

  const run = useGuardedAction(setMessage, setBusy);

  const selectedRepoIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);
  const activeWorkspaceIdRef = useRef<number | undefined>(undefined);
  const tasksRef = useRef<TaskSummary[]>([]);

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);

  // `activeWorkspace` is now the FOCUSED workspace (the one whose board is open),
  // not a global scope filter. Mission Control and the project list always show
  // every repo; per-workspace focus comes from the workspace board.
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId),
    [workspaces, activeWorkspaceId],
  );
  // The focused workspace's repos, offered as a multi-select in the composer so a
  // task can span several of them (cross-repo). Empty when no workspace board is open.
  const activeWorkspaceRepos = useMemo(
    () => (activeWorkspace ? repos.filter((repo) => activeWorkspace.repoIds.includes(repo.id)) : []),
    [activeWorkspace, repos],
  );
  // Mission Control shows every project's tasks (scope filter retired).
  const missionTasks = tasks;
  // The aggregated workspace board: all tasks whose repo is in the focused workspace.
  const workspaceBoardTasks = useMemo(
    () => (activeWorkspace ? tasks.filter((task) => activeWorkspace.repoIds.includes(task.repoId)) : []),
    [activeWorkspace, tasks],
  );

  const visibleTasks = useMemo(
    () => (selectedRepoId ? tasks.filter((task) => task.repoId === selectedRepoId) : tasks),
    [tasks, selectedRepoId],
  );

  // `openWorkspaceBoard` (focus a workspace + clear selection + route to it) is
  // now the store action of the same name, destructured above.
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

  // `refresh` now just (re)validates the bootstrap query cache; the bootstrap
  // queries refetch and the components re-render from the cache. The default-
  // selection derivation that used to live here runs reactively in the effects
  // below. A `preferredRepoId` still wins immediately (e.g. right after adding a
  // project) before the refetch lands.
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
    [queryClient],
  );

  // Pick the default agent once profiles/settings load (was refresh's job).
  useEffect(() => {
    if (selectedAgentProfileIdRef.current) return;
    const next = settings?.defaultAgentProfileId ?? agentProfiles[0]?.id;
    if (next !== undefined) {
      selectedAgentProfileIdRef.current = next;
      setSelectedAgentProfileId(next);
    }
  }, [settings, agentProfiles]);

  // Pick the default repo once repos load, keeping any existing selection.
  useEffect(() => {
    if (selectedRepoIdRef.current !== undefined) return;
    if (repos[0]) {
      selectedRepoIdRef.current = repos[0].id;
      setSelectedRepoId(repos[0].id);
    }
  }, [repos]);

  // Drop the focused workspace if it was deleted elsewhere, so the rail/Mission
  // Control don't filter against a phantom id.
  useEffect(() => {
    if (
      activeWorkspaceIdRef.current &&
      !workspaces.some((workspace) => workspace.id === activeWorkspaceIdRef.current)
    ) {
      activeWorkspaceIdRef.current = undefined;
      setActiveWorkspaceId(undefined);
    }
  }, [workspaces]);

  // The review-loop's effect on the task list (a passed loop marks the task done)
  // and all session/review/PR event subscriptions now live in the single
  // `useEventBridge` mounted at the app root — not here.
  const {
    selectedReviewLoop,
    setSelectedReviewLoop,
    selectedReviewRuns,
    setSelectedReviewRuns,
    liveReviewOutput,
  } = useTaskReviewLoop({
    selectedTaskId,
    onMessage: setMessage,
  });

  const sessionCommands = useSessionCommands({
    agentProfiles,
    selectedAgentProfileId,
    setMessage,
    setSelectedTaskId,
    setTasks,
  });

  const { startSession, resumeSession, stopSession, onSessionExit, onSessionInput } =
    useSessionAttentionControls({
      tasksRef,
      setTaskAttention,
      sessionCommands,
    });

  const applyTask = useCallback((updated: TaskSummary) => {
    setTasks((current) => replaceById(current, updated));
  }, []);

  const {
    githubStatus,
    ghReady: githubReady,
    pullRequest: selectedPullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    createPullRequest: createGithubPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
  } = useGithub({ selectedTask, setMessage, applyTask });

  // The JIRA board view + composer "create from story" are owned by `JiraView`.
  // `useApp` keeps only the JIRA connection status, for the open task's linked-story
  // browse URL (the facts rail's `jiraSite`).
  const jiraStatus = useJiraStatusQuery().data;

  const setTaskJiraLink = (
    taskId: number,
    link: { key: string; summary: string; url: string | null } | null,
  ) =>
    run(async () => {
      const updated = await api.setTaskJiraLink({
        taskId,
        key: link?.key ?? null,
        summary: link?.summary ?? null,
        url: link?.url ?? null,
      });
      setTasks((current) => replaceById(current, updated));
    });

  const createPullRequest = useCallback(
    async (task: TaskSummary, options?: { draft?: boolean }) => {
      // Prefer a deterministic gh-driven PR for worktree tasks — no agent needed.
      if (task.hasWorktree && githubReady) {
        await createGithubPullRequest(task, { draft: options?.draft ?? false });
        return;
      }

      // Fallback: ask the running agent to open the PR from the terminal.
      if (!task.activeSessionId) {
        setMessage(
          "Start or resume the agent to open a PR, or connect the GitHub CLI for a worktree task.",
        );
        return;
      }

      setMessage(null);
      setTaskAttention((current) => clearTaskAttention(current, task.id));

      try {
        await api.submitSessionInput(task.activeSessionId, CREATE_PULL_REQUEST_PROMPT);
      } catch (error) {
        setMessage(String(error));
      }
    },
    [githubReady, createGithubPullRequest, setMessage, setTaskAttention],
  );

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

  const updateStatus = (task: TaskSummary, status: TaskStatus) =>
    run(async () => {
      const updated = await api.updateTaskMetadata({ taskId: task.id, status });
      setTasks((current) => replaceById(current, updated));
      if (status === "done") {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
    });

  const renameTask = (task: TaskSummary, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === task.title) return;
    void run(async () => {
      const updated = await api.updateTaskMetadata({ taskId: task.id, title: trimmed });
      setTasks((current) => replaceById(current, updated));
    });
  };

  const startPairLoop = (task: TaskSummary, reviewerProfileId: number) =>
    run(async () => {
      const reviewLoop = await api.startPairLoop(task.id, reviewerProfileId);
      const reviewRuns = await api.listTaskReviewRuns(task.id);
      setSelectedReviewLoop(reviewLoop);
      setSelectedReviewRuns(reviewRuns);
      setMessage("Review: Started");
    });

  const startReview = (task: TaskSummary, reviewerProfileId: number) =>
    run(async () => {
      let reviewLoop = selectedReviewLoop;
      if (!reviewLoop || !isReviewLoopActive(reviewLoop.status)) {
        reviewLoop = await api.startPairLoop(task.id, reviewerProfileId);
      }
      const runningLoop = await api.runPairReview(task.id);
      const reviewRuns = await api.listTaskReviewRuns(task.id);
      const nextLoop = runningLoop ?? reviewLoop;
      setSelectedReviewLoop(
        nextLoop.status === "running" ? { ...nextLoop, status: "reviewing" } : nextLoop,
      );
      setSelectedReviewRuns(reviewRuns);
      setMessage("Review: Started");
    });

  const stopPairLoop = (task: TaskSummary) =>
    run(async () => {
      const reviewLoop = await api.stopPairLoop(task.id);
      setSelectedReviewLoop(reviewLoop);
      setMessage("Review: Stopped");
    });

  const requestDeleteTask = useTaskDeletion();

  // PR reviews are owned by `ReviewsView`, which calls `usePrReviews` directly
  // (the bridge keeps the list cache live, so it's safe per-component).

  // Settings + agent-profile saves and the JIRA token connect/disconnect are owned
  // by `SettingsView` (via `useSettingsActions` / `useJiraToken`).

  // Workspace create/update/delete are owned by `useWorkspaceActions` (used by the
  // workspace manager overlay).

  return {
    repos,
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    activeWorkspaceRepos,
    missionTasks,
    workspaceBoardTasks,
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
    visibleTasks,
    selectedTask,
    selectedReviewLoop,
    selectedReviewRuns,
    liveReviewOutput,
    taskAttention,
    liveLines,
    selectedTaskAttention: selectedTask ? getTaskAttention(taskAttention, selectedTask.id) : undefined,
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
    setTaskJiraLink,
    updateStatus,
    renameTask,
    requestDeleteTask,
    startSession,
    stopSession,
    resumeSession,
    createPullRequest,
    githubStatus,
    selectedPullRequest,
    pullRequestLoading,
    creatingPullRequest,
    pullRequestBusy,
    refreshPullRequest,
    mergePullRequest,
    setPullRequestReady,
    closePullRequest,
    jiraStatus,
    startPairLoop,
    startReview,
    stopPairLoop,
    onSessionExit,
    onSessionInput,
    selectedAgentProfileId,
    setSelectedAgentProfileId,
  };
}
