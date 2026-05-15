import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { api } from "../api";
import type {
  AgentProfile,
  AppSettings,
  AppSettingsInput,
  Repo,
  Session,
  SessionExitedEvent,
  SessionIdleEvent,
  SessionNeedsInputEvent,
  TaskStatus,
  TaskSummary,
} from "../types";

const isTauri = "__TAURI_INTERNALS__" in window;
const demoCreatedAt = "2026-05-15T12:00:00.000Z";
const demoRepo: Repo = {
  id: 100,
  name: "Nectus Demo",
  path: "/demo/nectus",
  defaultWorktreeRoot: "/demo/nectus-worktrees",
  createdAt: demoCreatedAt,
};
const demoAgentProfiles: AgentProfile[] = [
  {
    id: 100,
    name: "Codex",
    agentKind: "codex",
    command: "codex",
    model: null,
    args: [],
    env: {},
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
  {
    id: 101,
    name: "Claude",
    agentKind: "claude",
    command: "claude",
    model: null,
    args: [],
    env: {},
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
  {
    id: 102,
    name: "Gemini",
    agentKind: "gemini",
    command: "gemini",
    model: null,
    args: [],
    env: {},
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
];
const defaultDemoSettings: AppSettings = {
  defaultAgentProfileId: demoAgentProfiles[0].id,
  defaultWorktreeRootPattern: "../{repoName}-worktrees",
  defaultBranchPrefix: null,
  theme: "system",
  density: "comfortable",
  updatedAt: demoCreatedAt,
};
const demoTasks: TaskSummary[] = [
  {
    id: 1001,
    repoId: demoRepo.id,
    title: "Drag this task into Review",
    status: "planned",
    prUrl: null,
    agentProfileId: 100,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: "demo/drag-task",
    worktreePath: "/demo/nectus-worktrees/demo-drag-task",
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
  {
    id: 1002,
    repoId: demoRepo.id,
    title: "Inspect drop target feedback",
    status: "in_progress",
    prUrl: null,
    agentProfileId: 101,
    agentName: "Claude",
    agentKind: "claude",
    hasWorktree: false,
    branchName: null,
    worktreePath: null,
    isDirty: false,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
  {
    id: 1003,
    repoId: demoRepo.id,
    title: "Finished demo task",
    status: "done",
    prUrl: null,
    agentProfileId: 100,
    agentName: "Codex",
    agentKind: "codex",
    hasWorktree: true,
    branchName: "demo/done-task",
    worktreePath: "/demo/nectus-worktrees/demo-done-task",
    isDirty: true,
    activeSessionId: null,
    lastSessionId: null,
    lastSessionAgent: null,
    lastSessionCwd: null,
    lastSessionLabel: null,
    createdAt: demoCreatedAt,
    updatedAt: demoCreatedAt,
  },
];

async function notifySessionEvent(title: string, body: string) {
  if (!isTauri) return;

  try {
    const sent = await api.sendSystemNotification(title, body);
    if (!sent) {
      console.warn("Notification permission not granted");
    }
  } catch (error) {
    console.error("Failed to send session notification", error);
  }
}

export function useApp() {
  const demoMode = useMemo(() => new URLSearchParams(window.location.search).get("demo") === "1", []);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [currentView, setCurrentView] = useState<"dashboard" | "settings">("dashboard");
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  
  // New task form state
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskPrompt, setNewTaskPrompt] = useState("");
  const [newTaskBranchName, setNewTaskBranchName] = useState("");
  const [newTaskHasWorktree, setNewTaskHasWorktree] = useState(false);
  const [newTaskAgentProfileId, setNewTaskAgentProfileId] = useState<number | undefined>();
  
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirmingDeleteTaskId, setConfirmingDeleteTaskId] = useState<number | undefined>();

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
    return {
      active: tasks.filter((task) => task.activeSessionId).length,
      dirty: tasks.filter((task) => task.isDirty).length,
      review: tasks.filter((task) => task.status === "review").length,
    };
  }, [tasks]);

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
    if (!isTauri) return;

    const unlistenCallbacks: UnlistenFn[] = [];
    let disposed = false;

    const addListener = async <T,>(eventName: string, handler: Parameters<typeof listen<T>>[1]) => {
      const unlisten = await listen<T>(eventName, handler);
      if (disposed) {
        unlisten();
      } else {
        unlistenCallbacks.push(unlisten);
      }
    };

    const register = async () => {
      await addListener<SessionIdleEvent>("session_idle", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const agentName = task?.agentName ?? "Codex";
        const taskTitle = task?.title ?? "task is waiting";
        const detail = event.payload.message ? ` ${event.payload.message}` : "";
        const msg = `${agentName} finished: ${taskTitle}${detail}`;
        setMessage(msg);
        void notifySessionEvent(`${agentName} finished`, `${taskTitle}${detail}`);
      });
      await addListener<SessionNeedsInputEvent>("session_needs_input", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const agentName = task?.agentName ?? "Codex";
        const taskTitle = task?.title ?? "a task";
        const prompt = event.payload.prompt ? `: ${event.payload.prompt}` : "";
        const reason = event.payload.reason ? ` (${event.payload.reason})` : "";
        const msg = `${agentName} needs input for ${taskTitle}${reason}${prompt}`;
        setMessage(msg);
        void notifySessionEvent(`${agentName} needs input`, `${taskTitle}${reason}${prompt}`);
      });
      await addListener<SessionExitedEvent>("session_exited", (event) => {
        setTasks((current) =>
          current.map((task) => (task.activeSessionId === event.payload.sessionId ? { ...task, activeSessionId: null } : task)),
        );
      });
    };

    register().catch((error) => {
      if (!disposed) setMessage(String(error));
    });

    return () => {
      disposed = true;
      unlistenCallbacks.forEach((unlisten) => unlisten());
    };
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

  const resetCreateTaskForm = () => {
    setNewTaskTitle("");
    setNewTaskPrompt("");
    setNewTaskBranchName("");
    setNewTaskHasWorktree(false);
    setNewTaskAgentProfileId(settings?.defaultAgentProfileId ?? selectedAgentProfileIdRef.current);
  };

  const closeCreateTaskModal = () => {
    setCreateTaskOpen(false);
    resetCreateTaskForm();
  };

  const getGeneratedTaskTitle = () => {
    const title = newTaskTitle.trim();
    if (title) return title;

    const firstPromptLine = newTaskPrompt
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    return firstPromptLine ? firstPromptLine.slice(0, 80) : "Untitled task";
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
        agentProfileId: newTaskAgentProfileId,
        hasWorktree: newTaskHasWorktree,
        branchName: newTaskHasWorktree ? newTaskBranchName.trim() : null,
      });
      resetCreateTaskForm();
      setCreateTaskOpen(false);
      setSelectedTaskId(task.id);
      await refresh(selectedRepoId);
      setMessage(newTaskHasWorktree ? `Created ${task.branchName}` : `Created ${task.title}`);
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
      return;
    }

    try {
      const updated = await api.updateTaskMetadata({ taskId: task.id, status });
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
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
      setConfirmingDeleteTaskId(undefined);
      setMessage(`Deleted ${task.title}`);
      setBusy(false);
      return;
    }

    try {
      await api.deleteTask(task.id);
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setSelectedTaskId((current) => (current === task.id ? undefined : current));
      setConfirmingDeleteTaskId(undefined);
      setMessage(`Deleted ${task.title}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };

  const applySession = useCallback((session: Session) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== session.taskId) return task;
        return {
          ...task,
          activeSessionId: session.state === "running" ? session.id : null,
          lastSessionId: session.resumableSessionId ?? session.id,
          lastSessionLabel: session.resumableSessionLabel ?? task.lastSessionLabel,
        };
      }),
    );
  }, []);

  const startSession = async (task: TaskSummary) => {
    const agentProfileId = task.agentProfileId ?? selectedAgentProfileId ?? agentProfiles[0]?.id;
    if (!agentProfileId) return;
    setMessage(null);
    try {
      const session = await api.startSession(task.id, agentProfileId);
      applySession(session);
      setSelectedTaskId(task.id);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const stopSession = async (sessionId: string) => {
    setMessage(null);
    try {
      const session = await api.stopSession(sessionId);
      applySession(session);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const resumeSession = async (task: TaskSummary) => {
    setMessage(null);
    try {
      const session = await api.resumeSession(task.id);
      applySession(session);
      setSelectedTaskId(task.id);
    } catch (error) {
      setMessage(String(error));
    }
  };

  const onSessionExit = useCallback((sessionId: string) => {
    setTasks((current) =>
      current.map((task) => (task.activeSessionId === sessionId ? { ...task, activeSessionId: null } : task)),
    );
  }, []);

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
    selectedAgentProfileId,
    setSelectedAgentProfileId,
    saveAppSettings,
    saveAgentProfile,
  };
}
