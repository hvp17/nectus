import {
  Activity,
  Bot,
  CheckCircle2,
  Circle,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Square,
  TerminalSquare,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { TerminalPane } from "./TerminalPane";
import type { AgentProfile, Repo, Session, WorktreeStatus, WorktreeSummary } from "./types";

const statusLabels: Record<WorktreeStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

const statusOrder: WorktreeStatus[] = ["planned", "in_progress", "review", "done"];

function App() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeSummary[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | undefined>();
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<number | undefined>();
  const [repoPath, setRepoPath] = useState("");
  const [branchName, setBranchName] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<number | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId);
  const visibleWorktrees = selectedRepoId
    ? worktrees.filter((worktree) => worktree.repoId === selectedRepoId)
    : worktrees;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? visibleWorktrees[0];

  const counts = useMemo(() => {
    return {
      active: worktrees.filter((worktree) => worktree.activeSessionId).length,
      dirty: worktrees.filter((worktree) => worktree.isDirty).length,
      review: worktrees.filter((worktree) => worktree.status === "review").length,
    };
  }, [worktrees]);

  const refresh = useCallback(async () => {
    const [repoResult, profileResult] = await Promise.all([api.listRepos(), api.listAgentProfiles()]);
    setRepos(repoResult);
    setAgentProfiles(profileResult);
    if (!selectedAgentProfileId && profileResult[0]) {
      setSelectedAgentProfileId(profileResult[0].id);
    }
    const nextRepoId = selectedRepoId ?? repoResult[0]?.id;
    setSelectedRepoId(nextRepoId);
    const worktreeResult = await api.listWorktrees();
    setWorktrees(worktreeResult);
    if (!selectedWorktreeId && worktreeResult[0]) {
      setSelectedWorktreeId(worktreeResult[0].id);
    }
  }, [selectedAgentProfileId, selectedRepoId, selectedWorktreeId]);

  useEffect(() => {
    refresh().catch((error) => setMessage(String(error)));
  }, [refresh]);

  async function submitRepo(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const repo = await api.addRepo(repoPath.trim());
      setRepoPath("");
      setSelectedRepoId(repo.id);
      await refresh();
      setMessage(`Added ${repo.name}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function submitWorktree(event: FormEvent) {
    event.preventDefault();
    if (!selectedRepoId) return;
    setBusy(true);
    setMessage(null);
    try {
      const worktree = await api.createWorktree({
        repoId: selectedRepoId,
        branchName: branchName.trim(),
        taskTitle: taskTitle.trim(),
        agentProfileId: selectedAgentProfileId,
      });
      setBranchName("");
      setTaskTitle("");
      setSelectedWorktreeId(worktree.id);
      await refresh();
      setMessage(`Created ${worktree.branchName}`);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(worktree: WorktreeSummary, status: WorktreeStatus) {
    setMessage(null);
    try {
      const updated = await api.updateWorktreeMetadata({ worktreeId: worktree.id, status });
      setWorktrees((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function startSession(worktree: WorktreeSummary) {
    const agentProfileId = worktree.agentProfileId ?? selectedAgentProfileId ?? agentProfiles[0]?.id;
    if (!agentProfileId) return;
    setMessage(null);
    try {
      const session = await api.startSession(worktree.id, agentProfileId);
      applySession(session);
      setSelectedWorktreeId(worktree.id);
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

  function applySession(session: Session) {
    setWorktrees((current) =>
      current.map((worktree) => {
        if (worktree.id !== session.worktreeId) return worktree;
        return {
          ...worktree,
          activeSessionId: session.state === "running" ? session.id : null,
        };
      }),
    );
  }

  function onSessionExit(sessionId: string) {
    setWorktrees((current) =>
      current.map((worktree) => (worktree.activeSessionId === sessionId ? { ...worktree, activeSessionId: null } : worktree)),
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <h1>Nectus</h1>
            <span>Parallel agent worktrees</span>
          </div>
        </div>

        <form className="repo-form" onSubmit={submitRepo}>
          <label htmlFor="repo-path">Repository path</label>
          <div className="inline-field">
            <input
              id="repo-path"
              placeholder="/Users/tomas/project"
              value={repoPath}
              onChange={(event) => setRepoPath(event.target.value)}
            />
            <button className="icon-button" disabled={busy || !repoPath.trim()} title="Add repository">
              <Plus size={16} />
            </button>
          </div>
        </form>

        <div className="sidebar-section">
          <div className="section-title">Repos</div>
          {repos.length === 0 ? (
            <div className="empty-mini">No repositories yet</div>
          ) : (
            repos.map((repo) => (
              <button
                className={`repo-item ${repo.id === selectedRepoId ? "selected" : ""}`}
                key={repo.id}
                onClick={() => setSelectedRepoId(repo.id)}
              >
                <FolderGit2 size={16} />
                <span>{repo.name}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operations</p>
            <h2>{selectedRepo ? selectedRepo.name : "Add your first repository"}</h2>
          </div>
          <button className="ghost-button" onClick={() => refresh()} title="Refresh">
            <RefreshCw size={16} />
            Refresh
          </button>
        </header>

        <div className="metrics">
          <Metric icon={<Activity size={18} />} label="Running agents" value={counts.active} />
          <Metric icon={<GitBranch size={18} />} label="Dirty worktrees" value={counts.dirty} />
          <Metric icon={<CheckCircle2 size={18} />} label="In review" value={counts.review} />
        </div>

        {message ? <div className="message">{message}</div> : null}

        {selectedRepo ? (
          <form className="worktree-form" onSubmit={submitWorktree}>
            <input placeholder="task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} />
            <input placeholder="branch name" value={branchName} onChange={(event) => setBranchName(event.target.value)} />
            <select
              value={selectedAgentProfileId ?? ""}
              onChange={(event) => setSelectedAgentProfileId(Number(event.target.value))}
            >
              {agentProfiles.map((profile) => (
                <option value={profile.id} key={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <button disabled={busy || !taskTitle.trim() || !branchName.trim()}>
              <Plus size={16} />
              Create worktree
            </button>
          </form>
        ) : null}

        <div className="columns">
          {statusOrder.map((status) => (
            <section className="status-column" key={status}>
              <div className="column-heading">
                <span>{statusLabels[status]}</span>
                <b>{visibleWorktrees.filter((worktree) => worktree.status === status).length}</b>
              </div>
              {visibleWorktrees
                .filter((worktree) => worktree.status === status)
                .map((worktree) => (
                  <button
                    className={`worktree-card ${selectedWorktree?.id === worktree.id ? "selected" : ""}`}
                    key={worktree.id}
                    onClick={() => setSelectedWorktreeId(worktree.id)}
                  >
                    <div className="card-row">
                      <strong>{worktree.taskTitle}</strong>
                      {worktree.activeSessionId ? <span className="live-dot">live</span> : null}
                    </div>
                    <div className="branch-line">
                      <GitBranch size={14} />
                      {worktree.branchName}
                    </div>
                    <div className="card-row muted">
                      <span>{worktree.agentName ?? "No agent"}</span>
                      <span>{worktree.isDirty ? "dirty" : "clean"}</span>
                    </div>
                  </button>
                ))}
            </section>
          ))}
        </div>
      </section>

      <aside className="detail-pane">
        {selectedWorktree ? (
          <>
            <div className="detail-header">
              <div>
                <p className="eyebrow">Selected worktree</p>
                <h3>{selectedWorktree.taskTitle}</h3>
              </div>
              {selectedWorktree.activeSessionId ? (
                <button className="danger-button" onClick={() => stopSession(selectedWorktree.activeSessionId!)}>
                  <Square size={15} />
                  Stop
                </button>
              ) : (
                <button className="primary-button" onClick={() => startSession(selectedWorktree)}>
                  <Play size={15} />
                  Start
                </button>
              )}
            </div>

            <dl className="detail-list">
              <dt>Branch</dt>
              <dd>{selectedWorktree.branchName}</dd>
              <dt>Path</dt>
              <dd className="path">{selectedWorktree.path}</dd>
              <dt>Status</dt>
              <dd>
                <select value={selectedWorktree.status} onChange={(event) => updateStatus(selectedWorktree, event.target.value as WorktreeStatus)}>
                  {statusOrder.map((status) => (
                    <option value={status} key={status}>
                      {statusLabels[status]}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>PR</dt>
              <dd>
                {selectedWorktree.prUrl ? (
                  <a href={selectedWorktree.prUrl} target="_blank" rel="noreferrer">
                    Open <ExternalLink size={13} />
                  </a>
                ) : (
                  <span className="muted">None</span>
                )}
              </dd>
            </dl>

            <div className="terminal-title">
              <TerminalSquare size={16} />
              Agent terminal
            </div>
            <TerminalPane sessionId={selectedWorktree.activeSessionId} onSessionExit={onSessionExit} />
          </>
        ) : (
          <div className="empty-detail">
            <Circle size={28} />
            <h3>No worktree selected</h3>
            <p>Create a task worktree to start a Codex or Claude session.</p>
          </div>
        )}
      </aside>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default App;

