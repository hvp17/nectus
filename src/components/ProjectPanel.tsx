import { useEffect, useMemo, useState } from "react";
import { FolderGit2, Info, Plus, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { AGENT_STATE_META } from "../lib/agentState";
import { buildSidebarAgents, dominantState } from "../lib/sidebarAgents";
import type { AgentRow } from "../lib/agentState";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary, Workspace } from "../types";

interface ProjectPanelProps {
  repos: Repo[];
  workspaces: Workspace[];
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  liveLines: Record<number, string>;
  selectedRepoId?: number;
  /** The focused workspace whose board is open (none on Mission Control / project board). */
  selectedWorkspaceId?: number;
  onSelectRepo: (id: number) => void;
  onSelectWorkspace: (id: number) => void;
  onOpenTask: (id: number) => void;
  onAddProject: () => void;
  onManageWorkspaces: () => void;
  busy: boolean;
  loading: boolean;
}

/**
 * The persistent sidebar navigator: projects and workspaces, each opening its own
 * board, with that scope's in-flight agents nested inline. Replaces both the old
 * project rail and the rail's running-agents popup.
 */
export function ProjectPanel({
  repos,
  workspaces,
  tasks,
  taskAttention,
  liveLines,
  selectedRepoId,
  selectedWorkspaceId,
  onSelectRepo,
  onSelectWorkspace,
  onOpenTask,
  onAddProject,
  onManageWorkspaces,
  busy,
  loading,
}: ProjectPanelProps) {
  // The panel is always mounted, so it owns the elapsed-time tick (like Mission Control).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const repoNames = useMemo(() => new Map(repos.map((repo) => [repo.id, repo.name])), [repos]);
  const { byRepo, byWorkspace } = useMemo(
    () => buildSidebarAgents(tasks, taskAttention, repos, workspaces, liveLines, now),
    [tasks, taskAttention, repos, workspaces, liveLines, now],
  );

  return (
    <aside className="nx-panel" aria-label="Projects and workspaces">
      <div className="nx-panel-head">
        Nectus
        <button type="button" className="nx-panel-manage" onClick={onManageWorkspaces} aria-label="Manage workspaces">
          <Settings2 size={14} aria-hidden="true" />
          Manage
        </button>
      </div>

      <div className="nx-panel-scroll">
        <div className="nx-panel-sect">
          <div className="nx-panel-kick">
            <span>Projects</span>
            <button type="button" aria-label="Add project" onClick={onAddProject} disabled={busy}>
              <Plus size={13} aria-hidden="true" />
            </button>
          </div>
          {repos.length === 0 ? (
            <p className="nx-panel-empty">{loading ? "Loading projects…" : "Add a local git project to begin."}</p>
          ) : (
            repos.map((repo) => (
              <NavRow
                key={`repo-${repo.id}`}
                label={repo.name}
                icon={<FolderGit2 aria-hidden="true" />}
                active={repo.id === selectedRepoId}
                rows={byRepo.get(repo.id) ?? []}
                onSelect={() => onSelectRepo(repo.id)}
                onOpenTask={onOpenTask}
              />
            ))
          )}
        </div>

        {workspaces.length > 0 && (
          <div className="nx-panel-sect">
            <div className="nx-panel-kick">
              <span>Workspaces</span>
            </div>
            {workspaces.map((workspace) => (
              <NavRow
                key={`ws-${workspace.id}`}
                label={workspace.name}
                active={workspace.id === selectedWorkspaceId}
                rows={byWorkspace.get(workspace.id) ?? []}
                onSelect={() => onSelectWorkspace(workspace.id)}
                onOpenTask={onOpenTask}
                info={<WorkspaceInfo workspace={workspace} repoNames={repoNames} onSelectRepo={onSelectRepo} />}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function NavRow({
  label,
  icon,
  active,
  rows,
  onSelect,
  onOpenTask,
  info,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  rows: AgentRow[];
  onSelect: () => void;
  onOpenTask: (id: number) => void;
  info?: React.ReactNode;
}) {
  const tone = dominantState(rows);
  return (
    <div className="nx-nav-group">
      <button type="button" className="nx-proj" data-active={active} onClick={onSelect}>
        {icon}
        <span className="nx-proj-name">{label}</span>
        {info}
        {tone && <span className="nx-nav-dot" style={{ background: AGENT_STATE_META[tone].dot }} aria-hidden="true" />}
        <span className="nx-proj-count">{rows.length}</span>
      </button>
      {rows.length > 0 && (
        <div className="nx-nav-agents">
          {rows.map((row) => (
            <SidebarAgentRow key={row.task.id} row={row} onOpen={() => onOpenTask(row.task.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceInfo({
  workspace,
  repoNames,
  onSelectRepo,
}: {
  workspace: Workspace;
  repoNames: Map<number, string>;
  onSelectRepo: (id: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nx-nav-info"
          aria-label={`Projects in ${workspace.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="nx-info-card w-56 p-2">
        <div className="nx-info-title">{workspace.name}</div>
        {workspace.repoIds.length === 0 ? (
          <p className="nx-info-empty">No projects yet.</p>
        ) : (
          workspace.repoIds.map((repoId) => (
            <button key={repoId} type="button" className="nx-info-row" onClick={() => onSelectRepo(repoId)}>
              <FolderGit2 size={13} aria-hidden="true" />
              {repoNames.get(repoId) ?? `repo ${repoId}`}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
