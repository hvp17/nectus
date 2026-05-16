import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { api } from "../api";
import { defaultDemoSettings, demoAgentProfiles, demoRepo, demoTasks } from "../demoData";
import {
  clearTaskAttention,
  getAttentionCounts,
  getTaskAttention,
  type TaskAttention,
} from "../sessionAttention";
import { isTauriRuntime } from "../sessionNotifications";
import { useCreateTaskForm } from "./useCreateTaskForm";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionEvents } from "./useSessionEvents";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  Repo,
  ReviewLoop,
  ReviewLoopUpdatedEvent,
  ReviewRun,
  TaskStatus,
  TaskSummary,
} from "../types";

export function useApp() {
  const demoMode = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "1", []);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [selectedReviewLoop, setSelectedReviewLoop] = useState<ReviewLoop | null>(null);
  const [selectedReviewRuns, setSelectedReviewRuns] = useState<ReviewRun[]>([]);
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
  const selectedTaskIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);
  const tasksRef = useRef<TaskSummary[]>([]);
  const deletingTaskIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    selectedRepoIdRef.current = selectedRepoId;
  }, [selectedRepoId]);

  useEffect(() => {
    selectedTaskIdRef.current = selectedTaskId;
  }, [selectedTaskId]);

  useEffect(() => {
    selectedAgentProfileIdRef.current = selectedAgentProfileId;
  }, [selectedAgentProfileId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const setTaskDeleting = (taskId: number, deleting: boolean) => {
    const next = new Set(deletingTaskIdsRef.current);
    if (deleting) {
      next.add(taskId);
    } else {
      next.delete(taskId);
    }
    deletingTaskIdsRef.current = next;
    setDeletingTaskIds(next);
  };

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

  useEffect(() => {
    if (!selectedTaskId || demoMode) {
      setSelectedReviewLoop(null);
      setSelectedReviewRuns([]);
      return;
    }

    let disposed = false;
    Promise.all([api.getTaskReviewLoop(selectedTaskId), api.listTaskReviewRuns(selectedTaskId)])
      .then(([reviewLoop, reviewRuns]) => {
        if (disposed) return;
        setSelectedReviewLoop(reviewLoop);
        setSelectedReviewRuns(reviewRuns);
      })
      .catch((error) => {
        if (!disposed) setMessage(String(error));
      });

    return () => {
      disposed = true;
    };
  }, [demoMode, selectedTaskId]);

  useSessionEvents({ tasksRef, setTasks, setMessage, setTaskAttention });

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    listen<ReviewLoopUpdatedEvent>("review_loop_updated", (event) => {
      if (disposed) return;
      if (selectedTaskIdRef.current !== event.payload.taskId) return;
      setSelectedReviewLoop(event.payload.reviewLoop);
      if (event.payload.reviewRun) {
        setSelectedReviewRuns((current) => [...current, event.payload.reviewRun!]);
      }
    })
      .then((callback) => {
        if (disposed) {
          callback();
        } else {
          unlisten = callback;
        }
      })
      .catch((error) => {
        if (!disposed) setMessage(String(error));
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
      setMessage("Select an agent before creating a task.");
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

  const startPairLoop = async (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => {
    setMessage(null);
    if (demoMode) {
      const now = new Date().toISOString();
      setSelectedReviewLoop({
        taskId: task.id,
        reviewerProfileId,
        maxRounds,
        currentRound: 0,
        status: "running",
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });
      setSelectedReviewRuns([]);
      setMessage("Pair loop: Started");
      return;
    }

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
    if (demoMode) {
      setSelectedReviewLoop((current) =>
        current && current.taskId === task.id
          ? { ...current, status: "stopped", updatedAt: new Date().toISOString() }
          : current,
      );
      setMessage("Pair loop: Stopped");
      return;
    }

    try {
      const reviewLoop = await api.stopPairLoop(task.id);
      setSelectedReviewLoop(reviewLoop);
      setMessage("Pair loop: Stopped");
    } catch (error) {
      setMessage(String(error));
    }
  };

  const requestDeleteTask = (task: TaskSummary) => {
    setMessage(null);
    if (task.activeSessionId) {
      toast.error("Delete blocked", {
        description: "Stop the running session before deleting this task.",
        duration: 5000,
      });
      return;
    }
    if (deletingTaskIdsRef.current.has(task.id)) {
      return;
    }

    setTaskDeleting(task.id, true);
    const toastId = toast.loading(`Deleting ${task.title}`, {
      description: task.hasWorktree
        ? "Removing task and worktree in the background."
        : "Removing task in the background.",
      duration: Infinity,
    });

    const runDelete = async () => {
      try {
        if (!demoMode) {
          await api.deleteTask(task.id);
        }
        setTasks((current) => current.filter((item) => item.id !== task.id));
        setSelectedTaskId((current) => (current === task.id ? undefined : current));
        setTaskAttention((current) => clearTaskAttention(current, task.id));
        toast.success(`Deleted ${task.title}`, {
          id: toastId,
          description: task.hasWorktree ? "Task and worktree removed." : "Task removed.",
          duration: 5000,
        });
      } catch (error) {
        toast.error("Delete failed", {
          id: toastId,
          description: String(error),
          duration: 8000,
        });
      } finally {
        setTaskDeleting(task.id, false);
      }
    };

    void runDelete();
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
