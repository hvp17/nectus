import { useMemo, useState } from "react";
import { ChevronRight, FolderGit2, Info, Plus, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarProvider,
} from "./ui/sidebar";
import { cn } from "../lib/utils";
import { ProjectRowMenu } from "./ProjectRowMenu";
import { SidebarAgentRow } from "./SidebarAgentRow";
import { useMinuteNow } from "../hooks/useMinuteNow";
import { AGENT_STATE_META } from "../lib/agentState";
import { buildSidebarAgents, dominantState } from "../lib/sidebarAgents";
import { useAppStore } from "../store/appStore";
import type { AgentRow } from "../lib/agentState";
import type { Repo, TaskSummary, Workspace } from "../types";

/**
 * Hover-revealed per-row icon action (the "+"), pinned to the row's right edge.
 * It reserves its slot (opacity, not display) so the row doesn't reflow on hover.
 * Requires the row to carry `group/proj`; `ProjectRowMenu` mirrors this recipe
 * for its "⋯" trigger.
 */
const NAV_ROW_ACTION =
  "grid size-[18px] flex-none cursor-pointer place-items-center rounded-sm text-muted-foreground opacity-0 transition-opacity duration-[120ms] group-hover/proj:opacity-100 focus-visible:opacity-100 hover:bg-foreground/10 hover:text-foreground";

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
  /** Rename a project's display name (its path on disk is untouched). */
  onRenameProject: (repoId: number, name: string) => void;
  /** Remove a project from Nectus (backend refuses while tasks reference it). */
  onRemoveProject: (repoId: number) => void;
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
 * board, with that scope's in-flight agents nested inline. Built on the shadcn
 * Sidebar primitives in embedded mode (`collapsible="none"` — the shell's frame
 * grid owns the column, so the sidebar just fills it).
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
  onRenameProject,
  onRemoveProject,
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
  const chatWorkingTaskIds = useAppStore((s) => s.chatWorkingTaskIds);

  const repoNames = useMemo(() => new Map(repos.map((repo) => [repo.id, repo.name])), [repos]);
  const { byRepo, byWorkspace } = useMemo(
    () => buildSidebarAgents(tasks, taskAttention, repos, workspaces, liveLines, now, chatWorkingTaskIds),
    [tasks, taskAttention, repos, workspaces, liveLines, now, chatWorkingTaskIds],
  );

  return (
    <SidebarProvider className="h-full min-h-0 w-full min-w-0 max-[960px]:hidden">
      <Sidebar
        collapsible="none"
        className="h-full min-h-0 w-full min-w-0 border-r border-sidebar-border bg-sidebar/60"
        role="complementary"
        aria-label="Projects and workspaces"
      >
          <SidebarHeader className="flex-row items-center justify-between gap-2 px-3.5 pt-3.5 pb-2 text-[18px] font-bold tracking-[-0.02em]">
            Nectus
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={onManageWorkspaces}
              aria-label="Manage workspaces"
            >
              <Settings2 size={14} aria-hidden="true" />
              Manage
            </button>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="font-extrabold tracking-[0.09em] uppercase text-[10px]">
                Projects
              </SidebarGroupLabel>
              <SidebarGroupAction aria-label="Add project" onClick={onAddProject} disabled={busy}>
                <Plus aria-hidden="true" />
              </SidebarGroupAction>
              <SidebarGroupContent>
                {repos.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-muted-foreground">
                    {loading ? "Loading projects…" : "Add a local git project to begin."}
                  </p>
                ) : (
                  <SidebarMenu>
                    {repos.map((repo) => (
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
                        menu={
                          <ProjectRowMenu
                            repo={repo}
                            busy={busy}
                            onRename={onRenameProject}
                            onRemove={onRemoveProject}
                          />
                        }
                      />
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            </SidebarGroup>

            {workspaces.length > 0 && (
              <SidebarGroup>
                <SidebarGroupLabel className="font-extrabold tracking-[0.09em] uppercase text-[10px]">
                  Workspaces
                </SidebarGroupLabel>
                <SidebarGroupAction aria-label="New workspace" onClick={onManageWorkspaces} disabled={busy}>
                  <Plus aria-hidden="true" />
                </SidebarGroupAction>
                <SidebarGroupContent>
                  <SidebarMenu>
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
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
      </Sidebar>
    </SidebarProvider>
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
  menu,
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
  /** Hover-revealed row actions menu (e.g. project rename/remove). */
  menu?: React.ReactNode;
}) {
  const tone = dominantState(rows);
  // Nothing to fold when there are no nested agents — show a spacer instead of a
  // dead chevron so rows with and without agents stay left-aligned.
  const canCollapse = rows.length > 0;
  const expanded = canCollapse && !collapsed;
  return (
    <SidebarMenuItem className="flex flex-col">
      {/* A div with button semantics, not SidebarMenuButton: the row nests
          interactive children (chevron, info popover, "+", row menu), which a
          real <button> can't contain. It borrows the menu-button vocabulary. */}
      <div
        className={cn(
          "group/proj flex h-8 w-full cursor-pointer items-center gap-2 rounded-[calc(var(--radius-sm)+2px)] px-2 text-left text-[13px] font-semibold text-sidebar-foreground outline-hidden",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          "data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
          // The optional leading scope icon (a direct-child svg, never the nested buttons').
          "[&>svg]:size-[15px] [&>svg]:flex-none [&>svg]:opacity-80",
        )}
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
            className="-ml-[3px] grid size-4 flex-none cursor-pointer place-items-center rounded-sm p-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            data-expanded={expanded}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} agents in ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              className={cn("transition-transform duration-[120ms]", expanded && "rotate-90")}
            />
          </button>
        ) : (
          // A spacer of equal width stands in when a row has no agents, so
          // project/workspace names stay aligned.
          <span className="-ml-[3px] size-4 flex-none" aria-hidden="true" />
        )}
        {icon}
        <span className="truncate">{label}</span>
        {info}
        {tone && (
          <span
            className="ml-1 size-[7px] flex-none rounded-full"
            style={{ background: AGENT_STATE_META[tone].dot }}
            aria-hidden="true"
          />
        )}
        <span className="ml-1.5 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
          {rows.length}
        </span>
        {onCreateTask && (
          <button
            type="button"
            // On workspace rows the info button already anchors the trailing
            // cluster right; without it the "+" claims the auto margin itself.
            className={cn(NAV_ROW_ACTION, info ? "ml-1.5" : "ml-auto")}
            aria-label={createLabel}
            onClick={(event) => {
              event.stopPropagation();
              onCreateTask();
            }}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        )}
        {menu}
      </div>
      {expanded && (
        <SidebarMenuSub className="mx-2 gap-1.5 border-sidebar-border py-1.5 pr-0">
          {rows.map((row) => (
            <SidebarMenuSubItem key={row.task.id}>
              <SidebarAgentRow row={row} onOpen={() => onOpenTask(row.task.id)} />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
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
          className="ml-auto grid size-[18px] flex-none cursor-pointer place-items-center rounded-sm text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          aria-label={`Projects in ${workspace.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <Info size={13} aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="flex w-56 flex-col gap-0.5 p-2">
        <div className="px-1.5 pt-0.5 pb-1 text-[11px] font-extrabold tracking-[0.06em] text-muted-foreground uppercase">
          {workspace.name}
        </div>
        {workspace.repoIds.length === 0 ? (
          <p className="px-1.5 py-1 text-xs text-muted-foreground">No projects yet.</p>
        ) : (
          workspace.repoIds.map((repoId) => (
            <button
              key={repoId}
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] font-semibold text-foreground hover:bg-foreground/5"
              data-testid="workspace-info-repo"
              onClick={() => {
                setOpen(false);
                onSelectRepo(repoId);
              }}
            >
              <FolderGit2 size={13} aria-hidden="true" className="flex-none opacity-70" />
              {repoNames.get(repoId) ?? `repo ${repoId}`}
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}
