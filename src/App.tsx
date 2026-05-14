import {
  Activity,
  Bot,
  ChevronDown,
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
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { TerminalPane } from "./TerminalPane";
import type { AgentProfile, Repo, Session, TaskStatus, TaskSummary } from "./types";

const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];

function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedTaskId, setSelectedTaskId] = useState<number | undefined>();
  const [branchName, setBranchName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const selectedRepoIdRef = useRef<number | undefined>(undefined);
  const selectedAgentProfileIdRef = useRef<number | undefined>(undefined);

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
    await createTask(false);
  }

  async function createTask(hasWorktree: boolean) {
    if (!selectedRepoId) return;
    setBusy(true);
    setMessage(null);
    try {
      const task = await api.createTask({
        repoId: selectedRepoId,
        title: taskTitle.trim(),
        agentProfileId: selectedAgentProfileId,
        hasWorktree,
        branchName: hasWorktree ? branchName.trim() : null,
      });
      setBranchName("");
      setTaskTitle("");
      setSelectedTaskId(task.id);
      await refresh(selectedRepoId);
      setMessage(hasWorktree ? `Created ${task.branchName}` : `Created ${task.title}`);
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
          <form className="task-form" onSubmit={submitTask}>
            <Input placeholder="task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
            <Input placeholder="branch name" value={branchName} onChange={(event) => setBranchName(event.target.value)} />
            <Select
              value={selectedAgentProfileId ? String(selectedAgentProfileId) : undefined}
              onValueChange={(value) => setSelectedAgentProfileId(Number(value))}
            >
              <SelectTrigger aria-label="Agent profile">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                {agentProfiles.map((profile) => (
                  <SelectItem value={String(profile.id)} key={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" disabled={busy || !taskTitle.trim()}>
                  <Plus size={16} />
                  Create Task
                  <ChevronDown size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="task-menu">
                <DropdownMenuItem onSelect={() => createTask(false)}>
                  <Bot size={14} />
                  Create Task
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>With worktree</DropdownMenuLabel>
                <DropdownMenuItem disabled={!branchName.trim()} onSelect={() => createTask(true)}>
                  <GitBranch size={14} />
                  Create Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </form>
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
                      {task.activeSessionId ? <Badge>live</Badge> : null}
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
