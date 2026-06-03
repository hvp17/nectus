import { useEffect, useState } from "react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  FolderAddIcon,
  FolderGitIcon,
  GitPullRequestIcon,
  KanbanIcon,
  PlusSignIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { TaskRow } from "./TaskRow";
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import type { Repo, TaskStatus, TaskSummary } from "../types";

interface SidebarProps {
  repos: Repo[];
  selectedRepoId?: number;
  selectedTaskId?: number;
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  onSelectRepo: (id: number) => void;
  onOpenTask: (id: number) => void;
  onCreateTaskInRepo: (repoId: number) => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
  onOpenReviews: () => void;
  onOpenJira: () => void;
  onStopSession: (sessionId: string) => void;
  settingsActive: boolean;
  reviewsActive: boolean;
  jiraActive: boolean;
  busy: boolean;
  loading: boolean;
}

const statusSortWeight: Record<TaskStatus, number> = {
  review: 3,
  in_progress: 4,
  planned: 5,
  done: 6,
};

export function Sidebar({
  repos,
  selectedRepoId,
  selectedTaskId,
  tasks,
  taskAttention,
  onSelectRepo,
  onOpenTask,
  onCreateTaskInRepo,
  onAddProject,
  onOpenSettings,
  onOpenReviews,
  onOpenJira,
  onStopSession,
  settingsActive,
  reviewsActive,
  jiraActive,
  busy,
  loading,
}: SidebarProps) {
  const [expandedRepoIds, setExpandedRepoIds] = useState<Set<number>>(() =>
    selectedRepoId ? new Set([selectedRepoId]) : new Set(),
  );

  // Selecting a project (here or elsewhere, e.g. opening a task) always reveals its tasks.
  useEffect(() => {
    if (selectedRepoId === undefined) return;
    setExpandedRepoIds((current) => {
      if (current.has(selectedRepoId)) return current;
      const next = new Set(current);
      next.add(selectedRepoId);
      return next;
    });
  }, [selectedRepoId]);

  const handleProjectClick = (repoId: number) => {
    if (repoId === selectedRepoId) {
      setExpandedRepoIds((current) => {
        const next = new Set(current);
        if (next.has(repoId)) next.delete(repoId);
        else next.add(repoId);
        return next;
      });
      return;
    }
    onSelectRepo(repoId); // effect above expands the newly selected project
  };

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
                {repos.map((repo) => {
                  const repoTasks = sortRepoTasks(
                    tasks.filter((task) => task.repoId === repo.id),
                    taskAttention,
                  );
                  const expanded = expandedRepoIds.has(repo.id);
                  const needsAttention = repoTasks.some(
                    (task) => getTaskAttention(taskAttention, task.id)?.kind === "needs_input",
                  );

                  return (
                    <SidebarMenuItem key={repo.id} className="task-tree-project">
                      <SidebarMenuButton
                        type="button"
                        size="lg"
                        isActive={!settingsActive && repo.id === selectedRepoId}
                        className="nectus-sidebar-menu-button task-tree-project-button"
                        aria-expanded={expanded}
                        onClick={() => handleProjectClick(repo.id)}
                      >
                        <span className="task-tree-chevron" aria-hidden="true">
                          <HugeiconsIcon
                            icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
                            strokeWidth={2}
                          />
                        </span>
                        <HugeiconsIcon icon={FolderGitIcon} strokeWidth={2} aria-hidden="true" />
                        <span className="task-tree-project-name">{repo.name}</span>
                        {!expanded && needsAttention && (
                          <span
                            className="task-tree-project-attention"
                            data-tone="needs_input"
                            aria-label="Task needs input"
                          />
                        )}
                      </SidebarMenuButton>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SidebarMenuAction
                            type="button"
                            showOnHover
                            className="task-tree-add"
                            aria-label={`Add task to ${repo.name}`}
                            disabled={busy}
                            onClick={() => onCreateTaskInRepo(repo.id)}
                          >
                            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} aria-hidden="true" />
                          </SidebarMenuAction>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Add task
                        </TooltipContent>
                      </Tooltip>

                      {expanded && (
                        <SidebarMenuSub className="task-tree-list">
                          {repoTasks.length === 0 ? (
                            <li className="task-tree-empty">No tasks yet</li>
                          ) : (
                            repoTasks.map((task) => (
                              <TaskRow
                                key={task.id}
                                task={task}
                                attention={getTaskAttention(taskAttention, task.id)}
                                isActive={selectedTaskId === task.id}
                                onOpenTask={onOpenTask}
                                onStopSession={onStopSession}
                              />
                            ))
                          )}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              size="lg"
              isActive={jiraActive}
              className="nectus-sidebar-menu-button"
              onClick={onOpenJira}
            >
              <HugeiconsIcon icon={KanbanIcon} strokeWidth={2} aria-hidden="true" />
              <span>JIRA Board</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              size="lg"
              isActive={reviewsActive}
              className="nectus-sidebar-menu-button"
              onClick={onOpenReviews}
            >
              <HugeiconsIcon icon={GitPullRequestIcon} strokeWidth={2} aria-hidden="true" />
              <span>PR Reviews</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
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

function sortRepoTasks(repoTasks: TaskSummary[], taskAttention: TaskAttention[]): TaskSummary[] {
  return [...repoTasks].sort((left, right) => {
    const weightDiff = taskSortWeight(left, taskAttention) - taskSortWeight(right, taskAttention);
    if (weightDiff !== 0) return weightDiff;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function taskSortWeight(task: TaskSummary, taskAttention: TaskAttention[]): number {
  const attention = getTaskAttention(taskAttention, task.id);
  if (attention?.kind === "needs_input") return 0;
  if (attention?.kind === "idle") return 1;
  if (task.activeSessionId) return 2;
  return statusSortWeight[task.status];
}
