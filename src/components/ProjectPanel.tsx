import { useMemo, useState } from "react";
import { ChevronRight, FolderGit2, Info, Plus, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { useMinuteNow } from "../hooks/useMinuteNow";
import { AGENT_STATE_META } from "../lib/agentState";
import { buildSidebarAgents, dominantState } from "../lib/sidebarAgents";
import { useAppStore } from "../store/appStore";
import type { AgentRow } from "../lib/agentState";
import type { Repo, TaskSummary, Workspace } from "../types";

interface ProjectPanelProps {
  repos: Repo[];
  workspaces: Workspace[];
  tasks: TaskSummary[];
  selectedRepoId?: number;
  /** The focused workspace whose board is open (none on Mission Control / project board). */
  selectedWorkspaceId?: number;
  onSelectRepo: (id: number) => void;
  onSelectWorkspace: (id: number) => void;
  onOpenTask: (id: number) => void;
  /** Open the composer preselected to this project (Project mode). */
  onCreateTaskForRepo: (repoId: number) => void;
  /** Open the composer preselected to this workspace (cross-repo when it can fan out). */
  onCreateTaskForWorkspace: (workspaceId: number) => void;
  onAddProject: () => void;
  onManageWorkspaces: () => void;
  /** Persist the fold state of a project's nested in-flight agent list. */
  onToggleRepoCollapse: (id: number, collapsed: boolean) => void;
  /** Persist the fold state of a workspace's nested in-flight agent list. */
  onToggleWorkspaceCollapse: (id: number, collapsed: boolean) => void;
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
  selectedRepoId,
  selectedWorkspaceId,
  onSelectRepo,
  onSelectWorkspace,
  onOpenTask,
  onCreateTaskForRepo,
  onCreateTaskForWorkspace,
  onAddProject,
  onManageWorkspaces,
  onToggleRepoCollapse,
  onToggleWorkspaceCollapse,
  busy,
  loading,
}: ProjectPanelProps) {
  const now = useMinuteNow();
  // Subscribed here, not threaded through the shell: these are the hot runtime
  // fields (`liveLines` changes on every agent output line), and only this panel
  // among the persistent chrome displays them.
  const taskAttention = useAppStore((s) => s.taskAttention);
  const liveLines = useAppStore((s) => s.liveLines);

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
                collapsed={repo.collapsed}
                onToggleCollapse={() => onToggleRepoCollapse(repo.id, !repo.collapsed)}
                onSelect={() => onSelectRepo(repo.id)}
                onOpenTask={onOpenTask}
                onCreateTask={() => onCreateTaskForRepo(repo.id)}
                createLabel={`Add task to ${repo.name}`}
              />
            ))
          )}
        </div>

        {workspaces.length > 0 && (
          <div className="nx-panel-sect">
            <div className="nx-panel-kick">
              <span>Workspaces</span>
              <button type="button" aria-label="New workspace" onClick={onManageWorkspaces} disabled={busy}>
                <Plus size={13} aria-hidden="true" />
              </button>
            </div>
            {workspaces.map((workspace) => {
              // No "+" for a workspace whose members are all missing — there'd be no repo to seed.
              const hasRepos = workspace.repoIds.some((id) => repoNames.has(id));
              return (
                <NavRow
                  key={`ws-${workspace.id}`}
                  label={workspace.name}
                  active={workspace.id === selectedWorkspaceId}
                  rows={byWorkspace.get(workspace.id) ?? []}
                  collapsed={workspace.collapsed}
                  onToggleCollapse={() => onToggleWorkspaceCollapse(workspace.id, !workspace.collapsed)}
                  onSelect={() => onSelectWorkspace(workspace.id)}
                  onOpenTask={onOpenTask}
                  onCreateTask={hasRepos ? () => onCreateTaskForWorkspace(workspace.id) : undefined}
                  createLabel={`Add task to ${workspace.name}`}
                  info={<WorkspaceInfo workspace={workspace} repoNames={repoNames} onSelectRepo={onSelectRepo} />}
                />
              );
            })}
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
  collapsed,
  onToggleCollapse,
  onSelect,
  onOpenTask,
  onCreateTask,
  createLabel,
  info,
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  rows: AgentRow[];
  /** Whether the nested agent list is folded away (persisted UI preference). */
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: () => void;
  onOpenTask: (id: number) => void;
  /** Renders a hover-revealed "+" that opens the composer for this scope. */
  onCreateTask?: () => void;
  createLabel?: string;
  info?: React.ReactNode;
}) {
  const tone = dominantState(rows);
  // Nothing to fold when there are no nested agents — show a spacer instead of a
  // dead chevron so rows with and without agents stay left-aligned.
  const canCollapse = rows.length > 0;
  const expanded = canCollapse && !collapsed;
  return (
    <div className="nx-nav-group">
      <div
        className="nx-proj"
        data-active={active}
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        {canCollapse ? (
          <button
            type="button"
            className="nx-nav-chevron"
            data-expanded={expanded}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} agents in ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        ) : (
          <span className="nx-nav-chevron-spacer" aria-hidden="true" />
        )}
        {icon}
        <span className="nx-proj-name">{label}</span>
        {info}
        {tone && <span className="nx-nav-dot" style={{ background: AGENT_STATE_META[tone].dot }} aria-hidden="true" />}
        <span className="nx-proj-count">{rows.length}</span>
        {onCreateTask && (
          <button
            type="button"
            className="nx-nav-add"
            aria-label={createLabel}
            onClick={(event) => {
              event.stopPropagation();
              onCreateTask();
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        )}
      </div>
      {expanded && (
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
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
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
            <button
              key={repoId}
              type="button"
              className="nx-info-row"
              onClick={() => {
                setOpen(false);
                onSelectRepo(repoId);
              }}
            >
              <FolderGit2 size={13} aria-hidden="true" />
              {repoNames.get(repoId) ?? `repo ${repoId}`}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
