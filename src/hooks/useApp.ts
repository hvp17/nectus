import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api";
import {
  clearTaskAttention,
  getAttentionCounts,
  getTaskAttention,
  type TaskAttention,
} from "../sessionAttention";
import { useCreateTaskForm } from "./useCreateTaskForm";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionEvents } from "./useSessionEvents";
import { useSessionAttentionControls } from "./useSessionAttentionControls";
import { useTaskDeletion } from "./useTaskDeletion";
import { useTaskReviewLoop } from "./useTaskReviewLoop";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  Repo,
  TaskStatus,
  TaskSummary,
} from "../types";

export function useApp() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [currentView, setCurrentView] = useState<"dashboard" | "settings">("dashboard");
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [taskAttention, setTaskAttention] = useState<TaskAttention[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deletingTaskIds, setDeletingTaskIds] = useState<ReadonlySet<number>>(() => new Set());
  const taskForm = useCreateTaskForm(settings?.defaultAgentProfileId ?? selectedAgentProfileId);
  const {
    createTaskOpen,
    setCreateTaskOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPrompt,
    setNewTaskPrompt,
    newTaskBranchName,
    setNewTaskBranchName,
    newTaskHasWorktree,
    setNewTaskHasWorktree,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    resetCreateTaskForm,
    closeCreateTaskModal,
    getGeneratedTaskTitle,
  } = taskForm;

  const selectedRepoIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);
  const tasksRef = useRef<TaskSummary[]>([]);
  const deletingTaskIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const setTaskDeleting = useCallback((taskId: number, deleting: boolean) => {
    const next = new Set(deletingTaskIdsRef.current);
    if (deleting) {
      next.add(taskId);
    } else {
      next.delete(taskId);
    }
    deletingTaskIdsRef.current = next;
    setDeletingTaskIds(next);
  }, []);

  const selectedRepo = useMemo(() => repos.find((repo) => repo.id === selectedRepoId), [repos, selectedRepoId]);
  const visibleTasks = useMemo(() => {
    return selectedRepoId ? tasks.filter((task) => task.repoId === selectedRepoId) : tasks;
  }, [tasks, selectedRepoId]);
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

  const refresh = useCallback(async (preferredRepoId?: number) => {
    setLoading(true);
    try {
      const [repoResult, profileResult, settingsResult] = await Promise.all([
        api.listRepos(),
        api.listAgentProfiles(),
        api.getAppSettings(),
      ]);
      setRepos(repoResult);
      setAgentProfiles(profileResult);
      setSettings(settingsResult);

      const nextAgentProfileId =
        selectedAgentProfileIdRef.current ?? settingsResult.defaultAgentProfileId ?? profileResult[0]?.id;
      if (!selectedAgentProfileIdRef.current && nextAgentProfileId) {
        selectedAgentProfileIdRef.current = nextAgentProfileId;
        setSelectedAgentProfileId(nextAgentProfileId);
      }

      const nextRepoId = preferredRepoId ?? selectedRepoIdRef.current ?? repoResult[0]?.id;
      selectedRepoIdRef.current = nextRepoId;
      setSelectedRepoId(nextRepoId);

      const taskResult = await api.listTasks();
      setTasks(taskResult);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { selectedReviewLoop, setSelectedReviewLoop, selectedReviewRuns, setSelectedReviewRuns } = useTaskReviewLoop({
    selectedTaskId,
    onMessage: setMessage,
  });

  useSessionEvents({ tasksRef, setTasks, setMessage, setTaskAttention });

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

  const addProject = async () => {
    setMessage(null);

    try {
      const selected = await api.pickRepositoryFolder();
      if (selected) {
        setBusy(true);
        const repo = await api.addRepo(selected);
        setSelectedRepoId(repo.id);
        await refresh(repo.id);
        setMessage(`Added ${repo.name}`);
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const createTask = async () => {
    if (!selectedRepoId) return;
    if (!newTaskAgentProfileId) {
      setMessage("Select an agent before creating a task.");
      return;
    }
    if (newTaskHasWorktree && !newTaskBranchName.trim()) {
      setMessage("Enter a branch name to create a worktree.");
      return;
    }
    setBusy(true);
    setMessage(null);

    try {
      const task = await api.createTask({
        repoId: selectedRepoId,
        title: getGeneratedTaskTitle(),
        prompt: newTaskPrompt.trim() || null,
        agentProfileId: newTaskAgentProfileId,
        hasWorktree: newTaskHasWorktree,
        branchName: newTaskHasWorktree ? newTaskBranchName.trim() : null,
      });
      resetCreateTaskForm();
      setCreateTaskOpen(false);
      setSelectedTaskId(task.id);
      let startError: string | null = null;
      try {
        await api.startSession(task.id, newTaskAgentProfileId);
      } catch (error) {
        startError = String(error);
      }
      await refresh(selectedRepoId);
      if (startError) {
        setMessage(`Created ${task.title}, but failed to start session: ${startError}`);
      } else {
        setMessage(newTaskHasWorktree ? `Created ${task.branchName}` : `Created ${task.title}`);
      }
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (task: TaskSummary, status: TaskStatus) => {
    setMessage(null);

    try {
      const updated = await api.updateTaskMetadata({ taskId: task.id, status });
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      if (status === "done") {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
    } catch (error) {
      setMessage(String(error));
    }
  };

  const startPairLoop = async (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => {
    setMessage(null);

    try {
      const reviewLoop = await api.startPairLoop(task.id, reviewerProfileId, maxRounds);
      const reviewRuns = await api.listTaskReviewRuns(task.id);
      setSelectedReviewLoop(reviewLoop);
      setSelectedReviewRuns(reviewRuns);
      setMessage("Pair loop: Started");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const stopPairLoop = async (task: TaskSummary) => {
    setMessage(null);

    try {
      const reviewLoop = await api.stopPairLoop(task.id);
      setSelectedReviewLoop(reviewLoop);
      setMessage("Pair loop: Stopped");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const requestDeleteTask = useTaskDeletion({
    deletingTaskIdsRef,
    setTaskDeleting,
    setTasks,
    setSelectedTaskId,
    setTaskAttention,
    setMessage,
  });

  const saveAppSettings = async (input: AppSettingsInput) => {
    setBusy(true);
    setMessage(null);

    try {
      const updated = await api.updateAppSettings(input);
      setSettings(updated);
      setSelectedAgentProfileId(updated.defaultAgentProfileId ?? undefined);
      selectedAgentProfileIdRef.current = updated.defaultAgentProfileId ?? undefined;
      setMessage("Settings saved");
      await refresh(selectedRepoIdRef.current);
      return updated;
    } catch (error) {
      setMessage(String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const saveAgentProfile = async (profile: Partial<AgentProfile> & Pick<AgentProfile, "name" | "agentKind" | "command">) => {
    setBusy(true);
    setMessage(null);

    try {
      const saved = await api.upsertAgentProfile(profile);
      setAgentProfiles((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      setMessage(`Saved ${saved.name}`);
      return saved;
    } catch (error) {
      setMessage(String(error));
      throw error;
    } finally {
      setBusy(false);
    }
  };

  return {
    repos,
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
    taskAttention,
    selectedTaskAttention: selectedTask ? getTaskAttention(taskAttention, selectedTask.id) : undefined,
    counts,
    message,
    setMessage,
    busy,
    deletingTaskIds,
    loading,
    refresh,
    addProject,
    createTaskOpen,
    setCreateTaskOpen,
    newTaskTitle,
    setNewTaskTitle,
    newTaskPrompt,
    setNewTaskPrompt,
    newTaskBranchName,
    setNewTaskBranchName,
    newTaskHasWorktree,
    setNewTaskHasWorktree,
    newTaskAgentProfileId,
    setNewTaskAgentProfileId,
    createTask,
    closeCreateTaskModal,
    updateStatus,
    requestDeleteTask,
    startSession,
    stopSession,
    resumeSession,
    startPairLoop,
    stopPairLoop,
    onSessionExit,
    onSessionInput,
    selectedAgentProfileId,
    setSelectedAgentProfileId,
    saveAppSettings,
    saveAgentProfile,
  };
}
