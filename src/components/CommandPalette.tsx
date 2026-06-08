import { useEffect } from "react";
import { Circle, Folder, FolderGit2, GitPullRequest, Layers, Plus, Radio, Settings, SquareKanban } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import type { RailView } from "./IconRail";
import type { Repo, TaskSummary, Workspace } from "../types";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repos: Repo[];
  workspaces: Workspace[];
  tasks: TaskSummary[];
  canCreateTask: boolean;
  onNavigate: (view: RailView) => void;
  onOpenProject: (repoId: number) => void;
  onOpenWorkspace: (workspaceId: number) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: () => void;
}

const MAX_TASKS = 40;

/**
 * The ⌘K command palette — jump to any view / project / workspace / task and run
 * the New Task action. Mounted once in the shell; its own key listener toggles it
 * so ⌘K works from anywhere. Selecting an item routes through the shell's existing
 * handlers (which own the dismiss-overlay logic), so navigation stays consistent.
 */
export function CommandPalette({
  open,
  onOpenChange,
  repos,
  workspaces,
  tasks,
  canCreateTask,
  onNavigate,
  onOpenProject,
  onOpenWorkspace,
  onOpenTask,
  onCreateTask,
}: CommandPaletteProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Close first, then act, so the routed view isn't rendered behind the closing dialog.
  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects, tasks, or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Jump to">
          <CommandItem value="Mission Control" onSelect={() => run(() => onNavigate("mission"))}>
            <Radio />
            Mission Control
          </CommandItem>
          <CommandItem value="Board" onSelect={() => run(() => onNavigate("board"))}>
            <SquareKanban />
            Board
          </CommandItem>
          <CommandItem value="JIRA Board" onSelect={() => run(() => onNavigate("jira"))}>
            <FolderGit2 />
            JIRA Board
          </CommandItem>
          <CommandItem value="PR Reviews" onSelect={() => run(() => onNavigate("reviews"))}>
            <GitPullRequest />
            PR Reviews
          </CommandItem>
          <CommandItem value="Settings" onSelect={() => run(() => onNavigate("settings"))}>
            <Settings />
            Settings
          </CommandItem>
        </CommandGroup>

        {canCreateTask && (
          <CommandGroup heading="Actions">
            <CommandItem value="New task" onSelect={() => run(onCreateTask)}>
              <Plus />
              New task…
            </CommandItem>
          </CommandGroup>
        )}

        {repos.length > 0 && (
          <CommandGroup heading="Projects">
            {repos.map((repo) => (
              <CommandItem
                key={`repo-${repo.id}`}
                value={`project ${repo.name}`}
                onSelect={() => run(() => onOpenProject(repo.id))}
              >
                <Folder />
                {repo.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {workspaces.length > 0 && (
          <CommandGroup heading="Workspaces">
            {workspaces.map((workspace) => (
              <CommandItem
                key={`ws-${workspace.id}`}
                value={`workspace ${workspace.name}`}
                onSelect={() => run(() => onOpenWorkspace(workspace.id))}
              >
                <Layers />
                {workspace.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {tasks.length > 0 && (
          <CommandGroup heading="Tasks">
            {tasks.slice(0, MAX_TASKS).map((task) => (
              <CommandItem
                key={`task-${task.id}`}
                value={`task ${task.title} ${task.id}`}
                onSelect={() => run(() => onOpenTask(task.id))}
              >
                <Circle />
                {task.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
