import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  Activity,
  Bot,
  CheckCircle2,
  ExternalLink,
  FolderPlus,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/ui/tooltip";
import { TerminalPane } from "./TerminalPane";
import type {
  AgentProfile,
  Repo,
  Session,
  SessionExitedEvent,
  SessionIdleEvent,
  SessionNeedsInputEvent,
  TaskStatus,
  TaskSummary,
} from "./types";

const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];
const isTauri = "__TAURI_INTERNALS__" in window;

function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
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

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId);
  const visibleTasks = selectedRepoId
    ? tasks.filter((task) => task.repoId === selectedRepoId)
    : tasks;
  const selectedTask = visibleTasks.find((task) => task.id === selectedTaskId);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const counts = useMemo(() => {
    return {
      active: tasks.filter((task) => task.activeSessionId).length,
      dirty: tasks.filter((task) => task.isDirty).length,
      review: tasks.filter((task) => task.status === "review").length,
    };
  }, [tasks]);

  const refresh = useCallback(async (preferredRepoId?: number) => {
    setLoading(true);
    try {
      const [repoResult, profileResult] = await Promise.all([api.listRepos(), api.listAgentProfiles()]);
      setRepos(repoResult);
      setAgentProfiles(profileResult);
      if (!selectedAgentProfileIdRef.current && profileResult[0]) {
        selectedAgentProfileIdRef.current = profileResult[0].id;
        setSelectedAgentProfileId(profileResult[0].id);
      }
      const nextRepoId = preferredRepoId ?? selectedRepoIdRef.current ?? repoResult[0]?.id;
      selectedRepoIdRef.current = nextRepoId;
      setSelectedRepoId(nextRepoId);
      const taskResult = await api.listTasks();
      setTasks(taskResult);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
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
        setMessage(`${task?.agentName ?? "Codex"} finished: ${task?.title ?? "task is waiting"}`);
      });
      await addListener<SessionNeedsInputEvent>("session_needs_input", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const prompt = event.payload.prompt ? `: ${event.payload.prompt}` : "";
        setMessage(`${task?.agentName ?? "Codex"} needs input for ${task?.title ?? "a task"}${prompt}`);
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

  async function addProject() {
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
  }

  async function submitTask(event: FormEvent) {
    event.preventDefault();
    await createTask();
  }

  function resetCreateTaskForm() {
    setNewTaskTitle("");
    setNewTaskPrompt("");
    setNewTaskBranchName("");
    setNewTaskHasWorktree(false);
    setNewTaskAgentProfileId(undefined);
  }

  function closeCreateTaskModal() {
    setCreateTaskOpen(false);
    resetCreateTaskForm();
  }

  function getGeneratedTaskTitle() {
    const title = newTaskTitle.trim();
    if (title) return title;

    const firstPromptLine = newTaskPrompt
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);

    return firstPromptLine ? firstPromptLine.slice(0, 80) : "Untitled task";
  }

  async function createTask() {
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
  }

  async function updateStatus(task: TaskSummary, status: TaskStatus) {
    setMessage(null);
    try {
      const updated = await api.updateTaskMetadata({ taskId: task.id, status });
      setTasks((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function requestDeleteTask(task: TaskSummary) {
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
  }

  async function startSession(task: TaskSummary) {
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
  }

  async function stopSession(sessionId: string) {
    setMessage(null);
    try {
      const session = await api.stopSession(sessionId);
      applySession(session);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function resumeSession(task: TaskSummary) {
    setMessage(null);
    try {
      const session = await api.resumeSession(task.id);
      applySession(session);
      setSelectedTaskId(task.id);
    } catch (error) {
      setMessage(String(error));
    }
  }

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

  const onSessionExit = useCallback((sessionId: string) => {
    setTasks((current) =>
      current.map((task) => (task.activeSessionId === sessionId ? { ...task, activeSessionId: null } : task)),
    );
  }, []);

  return (
    <TooltipProvider>
      <main className={`app-shell ${selectedTask ? "detail-open" : ""}`}>
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-mark">N</div>
            <div>
              <h1>Nectus</h1>
              <span>Parallel agent tasks</span>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-title project-section-title">
              <span>Projects</span>
              <Button type="button" size="icon-lg" onClick={addProject} disabled={busy} title="Add project" aria-label="Add project">
                <FolderPlus size={16} />
              </Button>
            </div>
            {repos.length === 0 ? (
              <div className="empty-mini">{loading ? "Loading projects..." : "No projects yet"}</div>
            ) : (
              repos.map((repo) => (
                <Button
                  variant={repo.id === selectedRepoId ? "secondary" : "ghost"}
                  className={`repo-item ${repo.id === selectedRepoId ? "selected" : ""}`}
                  key={repo.id}
                  onClick={() => {
                    setSelectedRepoId(repo.id);
                    setSelectedTaskId(undefined);
                  }}
                >
                  <FolderGit2 size={16} />
                  <span>{repo.name}</span>
                </Button>
              ))
            )}
          </div>
        </aside>

        <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations</p>
            <h2>{selectedRepo ? selectedRepo.name : loading ? "Loading projects" : "Add your first project"}</h2>
          </div>
          <Button variant="outline" size="lg" onClick={() => refresh()} title="Refresh">
            <RefreshCw size={16} />
            Refresh
          </Button>
        </header>

        <div className="metrics">
          <Metric icon={<Activity size={18} />} label="Running agents" value={counts.active} />
          <Metric icon={<GitBranch size={18} />} label="Dirty tasks" value={counts.dirty} />
          <Metric icon={<CheckCircle2 size={18} />} label="In review" value={counts.review} />
        </div>

        {message ? (
          <Alert className="message">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {selectedRepo ? (
          <div className="task-toolbar">
            <Button type="button" size="lg" onClick={() => setCreateTaskOpen(true)} disabled={busy}>
              <Plus size={16} />
              Create new task
            </Button>
          </div>
        ) : null}

        <div className="columns">
          {statusOrder.map((status) => (
            <section className="status-column" key={status}>
              <div className="column-heading">
                <span>{statusLabels[status]}</span>
                <Badge variant="secondary">{visibleTasks.filter((task) => task.status === status).length}</Badge>
              </div>
              {visibleTasks
                .filter((task) => task.status === status)
                .map((task) => (
                  <Card
                    className={`task-card ${selectedTask?.id === task.id ? "selected" : ""}`}
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTaskId(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedTaskId(task.id);
                      }
                    }}
                  >
                    <div className="card-row">
                      <strong>{task.title}</strong>
                      <div className="task-card-actions">
                        {task.activeSessionId ? <Badge>live</Badge> : null}
                        <DeleteTaskButton
                          task={task}
                          busy={busy}
                          confirming={confirmingDeleteTaskId === task.id}
                          onDelete={requestDeleteTask}
                        />
                      </div>
                    </div>
                    <div className="branch-line">
                      {task.hasWorktree ? <GitBranch size={14} /> : <Bot size={14} />}
                      {task.hasWorktree ? task.branchName : "No worktree"}
                    </div>
                    <div className="card-row muted">
                      <span>{task.agentName ?? "No agent"}</span>
                      <span>{task.hasWorktree ? (task.isDirty ? "dirty" : "clean") : "task"}</span>
                    </div>
                  </Card>
                ))}
            </section>
          ))}
        </div>
        </section>

        {createTaskOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={closeCreateTaskModal}>
            <form
              className="task-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="create-task-title"
              onSubmit={submitTask}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="task-modal-header">
                <div>
                  <p className="eyebrow">Task setup</p>
                  <h3 id="create-task-title">Create new task</h3>
                </div>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  onClick={closeCreateTaskModal}
                  aria-label="Close task modal"
                  title="Close"
                >
                  <X size={16} />
                </Button>
              </div>

              <div className="task-modal-body">
                <div className="field">
                  <Label htmlFor="new-task-title">Title</Label>
                  <Input
                    id="new-task-title"
                    placeholder="Optional"
                    value={newTaskTitle}
                    onChange={(event) => setNewTaskTitle(event.target.value)}
                  />
                </div>

                <fieldset className="field-group">
                  <legend>Model</legend>
                  <div className="choice-grid">
                    {agentProfiles.map((profile) => (
                      <label className="choice-card" key={profile.id}>
                        <input
                          type="radio"
                          name="agent-profile"
                          value={profile.id}
                          checked={newTaskAgentProfileId === profile.id}
                          onChange={() => setNewTaskAgentProfileId(profile.id)}
                        />
                        <span>{profile.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div className="field">
                  <Label htmlFor="new-task-prompt">Chat prompt</Label>
                  <textarea
                    id="new-task-prompt"
                    value={newTaskPrompt}
                    onChange={(event) => setNewTaskPrompt(event.target.value)}
                    placeholder="What should the agent work on?"
                    rows={6}
                  />
                </div>

                <fieldset className="field-group">
                  <legend>Git worktree</legend>
                  <div className="choice-grid">
                    <label className="choice-card">
                      <input
                        type="radio"
                        name="worktree-mode"
                        checked={!newTaskHasWorktree}
                        onChange={() => setNewTaskHasWorktree(false)}
                      />
                      <span>Without worktree</span>
                    </label>
                    <label className="choice-card">
                      <input
                        type="radio"
                        name="worktree-mode"
                        checked={newTaskHasWorktree}
                        onChange={() => setNewTaskHasWorktree(true)}
                      />
                      <span>Use worktree</span>
                    </label>
                  </div>
                </fieldset>

                {newTaskHasWorktree ? (
                  <div className="field">
                    <Label htmlFor="new-task-branch">Branch name</Label>
                    <Input
                      id="new-task-branch"
                      placeholder="feature/my-task"
                      value={newTaskBranchName}
                      onChange={(event) => setNewTaskBranchName(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>

              <div className="task-modal-actions">
                <Button type="button" variant="outline" size="lg" onClick={closeCreateTaskModal}>
                  Cancel
                </Button>
                <Button type="submit" size="lg" disabled={busy || !newTaskAgentProfileId || (newTaskHasWorktree && !newTaskBranchName.trim())}>
                  <Plus size={16} />
                  Create task
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {selectedTask ? (
          <aside className="detail-pane">
            <>
            <div className="detail-header">
              <div>
                <p className="eyebrow">Selected task</p>
                <h3>{selectedTask.title}</h3>
              </div>
              {selectedTask.activeSessionId ? (
                <Button variant="destructive" size="lg" onClick={() => stopSession(selectedTask.activeSessionId!)}>
                  <Square size={15} />
                  Stop
                </Button>
              ) : (
                <div className="detail-actions">
                  {selectedTask.lastSessionId ? (
                    <Button variant="outline" size="lg" onClick={() => resumeSession(selectedTask)}>
                      <RotateCcw size={15} />
                      Resume
                    </Button>
                  ) : null}
                  <Button size="lg" onClick={() => startSession(selectedTask)}>
                    <Play size={15} />
                    Start
                  </Button>
                  <DeleteTaskButton
                    task={selectedTask}
                    busy={busy}
                    confirming={confirmingDeleteTaskId === selectedTask.id}
                    onDelete={requestDeleteTask}
                    size="lg"
                  />
                </div>
              )}
            </div>

            <dl className="detail-list">
              <dt>Mode</dt>
              <dd>{selectedTask.hasWorktree ? "With worktree" : "Task only"}</dd>
              {selectedTask.hasWorktree ? (
                <>
                  <dt>Branch</dt>
                  <dd>{selectedTask.branchName}</dd>
                  <dt>Path</dt>
                  <dd className="path">{selectedTask.worktreePath}</dd>
                </>
              ) : null}
              <dt>Status</dt>
              <dd>
                <Select value={selectedTask.status} onValueChange={(value) => updateStatus(selectedTask, value as TaskStatus)}>
                  <SelectTrigger aria-label="Task status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statusOrder.map((status) => (
                      <SelectItem value={status} key={status}>
                        {statusLabels[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </dd>
              <dt>PR</dt>
              <dd>
                {selectedTask.prUrl ? (
                  <a href={selectedTask.prUrl} target="_blank" rel="noreferrer">
                    Open <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="muted">None</span>
                )}
              </dd>
              <dt>Session</dt>
              <dd className="path">
                {selectedTask.lastSessionLabel ? `${selectedTask.lastSessionLabel} (${selectedTask.lastSessionId})` : selectedTask.lastSessionId ?? "None"}
              </dd>
              <dt>Agent</dt>
              <dd className="path">{selectedTask.lastSessionAgent ?? selectedTask.agentName ?? "None"}</dd>
              <dt>CWD</dt>
              <dd className="path">{selectedTask.lastSessionCwd ?? selectedTask.worktreePath ?? "None"}</dd>
            </dl>

            <div className="terminal-title">
              <TerminalSquare size={16} />
              Agent terminal
            </div>
            <TerminalPane sessionId={selectedTask.activeSessionId} onSessionExit={onSessionExit} />
            </>
          </aside>
        ) : null}
      </main>
    </TooltipProvider>
  );
}

function DeleteTaskButton({
  task,
  busy,
  confirming,
  onDelete,
  size = "icon-sm",
}: {
  task: TaskSummary;
  busy: boolean;
  confirming: boolean;
  onDelete: (task: TaskSummary) => void;
  size?: "icon-sm" | "lg";
}) {
  const disabled = busy || Boolean(task.activeSessionId);
  const label = task.activeSessionId ? "Stop session before deleting" : confirming ? "Confirm delete" : "Delete task";

  return (
    <Tooltip open={confirming || undefined}>
      <TooltipTrigger asChild>
        <span className="delete-task-trigger">
          <Button
            type="button"
            variant="destructive"
            size={size}
            disabled={disabled}
            aria-label={label}
            title={label}
            onClick={(event) => {
              event.stopPropagation();
              onDelete(task);
            }}
          >
            <Trash2 size={15} />
            {size === "lg" ? "Delete" : null}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {task.activeSessionId ? "Stop session first" : confirming ? "Click again to delete" : "Delete task"}
      </TooltipContent>
    </Tooltip>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card size="sm" className="metric">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <CardAction>{icon}</CardAction>
      </CardHeader>
      <CardContent>
        <strong>{value}</strong>
      </CardContent>
    </Card>
  );
}

export default App;
