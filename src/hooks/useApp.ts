import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api";
import { defaultDemoSettings, demoAgentProfiles, demoRepo, demoTasks } from "../demoData";
import {
  clearTaskAttention,
  getAttentionCounts,
  getTaskAttention,
  type TaskAttention,
} from "../sessionAttention";
import { useCreateTaskForm } from "./useCreateTaskForm";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionEvents } from "./useSessionEvents";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  Repo,
  TaskStatus,
  TaskSummary,
} from "../types";

export function useApp() {
  const demoMode = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "1", []);
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
  const [confirmingDeleteTaskId, setConfirmingDeleteTaskId] = useState<number | undefined>();
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

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

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
    if (demoMode) {
      const nextRepoId = preferredRepoId ?? selectedRepoIdRef.current ?? demoRepo.id;
      selectedRepoIdRef.current = nextRepoId;
      selectedAgentProfileIdRef.current = selectedAgentProfileIdRef.current ?? demoAgentProfiles[0].id;
      setRepos([demoRepo]);
      setAgentProfiles(demoAgentProfiles);
      setSettings((current) => current ?? defaultDemoSettings);
      setSelectedRepoId(nextRepoId);
      setSelectedAgentProfileId(selectedAgentProfileIdRef.current);
      setTasks((current) => (current.length ? current : demoTasks));
      setLoading(false);
      return;
    }

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
  }, [demoMode]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useSessionEvents({ tasksRef, setTasks, setMessage, setTaskAttention });
  const sessionCommands = useSessionCommands({
    agentProfiles,
    selectedAgentProfileId,
    setMessage,
    setSelectedTaskId,
    setTasks,
  });

  const startSession = async (task: TaskSummary) => {
    setTaskAttention((current) => clearTaskAttention(current, task.id));
    await sessionCommands.startSession(task);
  };

  const resumeSession = async (task: TaskSummary) => {
    setTaskAttention((current) => clearTaskAttention(current, task.id));
    await sessionCommands.resumeSession(task);
  };

  const stopSession = async (sessionId: string) => {
    const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
    if (task) {
      setTaskAttention((current) => clearTaskAttention(current, task.id));
    }
    await sessionCommands.stopSession(sessionId);
  };

  const onSessionExit = useCallback(
    (sessionId: string) => {
      const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
      if (task) {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
      sessionCommands.onSessionExit(sessionId);
    },
    [sessionCommands],
  );

  const onSessionInput = useCallback((sessionId: string) => {
    const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
    if (task) {
      setTaskAttention((current) => clearTaskAttention(current, task.id));
    }
  }, []);

  const addProject = async () => {
    setMessage(null);
    if (demoMode) {
      setMessage("Demo mode uses fixture data. Remove ?demo=1 to add local projects.");
      return;
    }

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
      setMessage("Select Codex or Claude before creating a task.");
      return;
    }
    if (newTaskHasWorktree && !newTaskBranchName.trim()) {
      setMessage("Enter a branch name to create a worktree.");
      return;
    }
    setBusy(true);
    setMessage(null);
    if (demoMode) {
      const now = new Date().toISOString();
      const task: TaskSummary = {
        id: Date.now(),
        repoId: selectedRepoId,
        title: getGeneratedTaskTitle(),
        prompt: newTaskPrompt.trim() || null,
        status: "planned",
        prUrl: null,
        agentProfileId: newTaskAgentProfileId,
        agentName: demoAgentProfiles.find((profile) => profile.id === newTaskAgentProfileId)?.name ?? null,
        agentKind: demoAgentProfiles.find((profile) => profile.id === newTaskAgentProfileId)?.agentKind ?? null,
        hasWorktree: newTaskHasWorktree,
        branchName: newTaskHasWorktree ? newTaskBranchName.trim() : null,
        worktreePath: newTaskHasWorktree ? `${demoRepo.defaultWorktreeRoot}/${newTaskBranchName.trim()}` : null,
        isDirty: false,
        activeSessionId: null,
        lastSessionId: null,
        lastSessionAgent: null,
        lastSessionCwd: null,
        lastSessionLabel: null,
        createdAt: now,
        updatedAt: now,
      };
      setTasks((current) => [...current, task]);
      resetCreateTaskForm();
      setCreateTaskOpen(false);
      setSelectedTaskId(task.id);
      setMessage(`Created ${task.title}`);
      setBusy(false);
      return;
    }

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
    if (demoMode) {
      const updatedAt = new Date().toISOString();
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? { ...item, status, updatedAt } : item)),
      );
      if (status === "done") {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
      return;
    }

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

  const requestDeleteTask = async (task: TaskSummary) => {
    setMessage(null);
    if (task.activeSessionId) {
      setMessage("Stop the running session before deleting this task.");
      return;
    }
    if (confirmingDeleteTaskId !== task.id) {
      setConfirmingDeleteTaskId(task.id);
      return;
    }

    setBusy(true);
    if (demoMode) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setSelectedTaskId((current) => (current === task.id ? undefined : current));
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      setConfirmingDeleteTaskId(undefined);
      setMessage(`Deleted ${task.title}`);
      setBusy(false);
      return;
    }

    try {
      await api.deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setSelectedTaskId((current) => (current === task.id ? undefined : current));
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      setConfirmingDeleteTaskId(undefined);
      setMessage(`Deleted ${task.title}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveAppSettings = async (input: AppSettingsInput) => {
    setBusy(true);
    setMessage(null);
    if (demoMode) {
      const updated = { ...input, updatedAt: new Date().toISOString() };
      setSettings(updated);
      setSelectedAgentProfileId(input.defaultAgentProfileId ?? undefined);
      selectedAgentProfileIdRef.current = input.defaultAgentProfileId ?? undefined;
      setMessage("Settings saved");
      setBusy(false);
      return updated;
    }

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
    if (demoMode) {
      const now = new Date().toISOString();
      const saved: AgentProfile = {
        id: profile.id ?? Date.now(),
        name: profile.name,
        agentKind: profile.agentKind,
        command: profile.command,
        model: profile.model ?? null,
        args: profile.args ?? [],
        env: profile.env ?? {},
        createdAt: profile.createdAt ?? now,
        updatedAt: now,
      };
      setAgentProfiles((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists ? current.map((item) => (item.id === saved.id ? saved : item)) : [...current, saved];
      });
      setMessage(`Saved ${saved.name}`);
      setBusy(false);
      return saved;
    }

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
    taskAttention,
    selectedTaskAttention: selectedTask ? getTaskAttention(taskAttention, selectedTask.id) : undefined,
    counts,
    message,
    setMessage,
    busy,
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
    confirmingDeleteTaskId,
    startSession,
    stopSession,
    resumeSession,
    onSessionExit,
    onSessionInput,
    selectedAgentProfileId,
    setSelectedAgentProfileId,
    saveAppSettings,
    saveAgentProfile,
  };
}
