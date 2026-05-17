import { FolderAddIcon, FolderGitIcon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TaskQuickAccessPanel } from "./TaskQuickAccessPanel";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import type { TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary } from "../types";

interface SidebarProps {
  repos: Repo[];
  selectedRepoId?: number;
  selectedTaskId?: number;
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  onSelectRepo: (id: number) => void;
  onOpenTask: (id: number) => void;
  onCreateTask: () => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
  onStopSession: (sessionId: string) => void;
  settingsActive: boolean;
  busy: boolean;
  loading: boolean;
}

export function Sidebar({
  repos,
  selectedRepoId,
  selectedTaskId,
  tasks,
  taskAttention,
  onSelectRepo,
  onOpenTask,
  onCreateTask,
  onAddProject,
  onOpenSettings,
  onStopSession,
  settingsActive,
  busy,
  loading,
}: SidebarProps) {
  return (
    <SidebarRoot collapsible="none" className="nectus-sidebar">
      <SidebarHeader className="nectus-sidebar-header">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Nectus</h1>
            <span className="text-[10px] uppercase tracking-widest font-extrabold opacity-50">Parallel Agents</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="nectus-sidebar-content">
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupAction type="button" onClick={onAddProject} disabled={busy} aria-label="Add project">
            <HugeiconsIcon icon={FolderAddIcon} strokeWidth={2} aria-hidden="true" />
          </SidebarGroupAction>
          <SidebarGroupContent>
            {repos.length === 0 ? (
              <Empty className="empty-mini border-0 p-2 text-left">
                <EmptyHeader className="items-start">
                  <EmptyTitle>{loading ? "Loading projects..." : "No projects yet"}</EmptyTitle>
                  {!loading && <EmptyDescription>Add a local git project to begin.</EmptyDescription>}
                </EmptyHeader>
              </Empty>
            ) : (
              <SidebarMenu>
                {repos.map((repo) => (
                  <SidebarMenuItem key={repo.id}>
                    <SidebarMenuButton
                      type="button"
                      size="lg"
                      isActive={!settingsActive && repo.id === selectedRepoId}
                      className="nectus-sidebar-menu-button"
                      onClick={() => onSelectRepo(repo.id)}
                    >
                      <HugeiconsIcon icon={FolderGitIcon} strokeWidth={2} aria-hidden="true" />
                      <span>{repo.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        <TaskQuickAccessPanel
          tasks={tasks}
          taskAttention={taskAttention}
          selectedTaskId={selectedTaskId}
          onOpenTask={onOpenTask}
          onCreateTask={onCreateTask}
          onStopSession={onStopSession}
          createTaskDisabled={busy || !selectedRepoId}
        />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              size="lg"
              isActive={settingsActive}
              className="nectus-sidebar-menu-button"
              onClick={onOpenSettings}
            >
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={2} aria-hidden="true" />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </SidebarRoot>
  );
}
