import { FolderPlus, FolderGit2, Settings } from "lucide-react";
import { Button } from "./ui/button";
import { TaskQuickAccessPanel } from "./TaskQuickAccessPanel";
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
  onAddProject,
  onOpenSettings,
  onStopSession,
  settingsActive,
  busy,
  loading,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-main">
        <div className="brand">
          <div className="brand-mark">N</div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Nectus</h1>
            <span className="text-[10px] uppercase tracking-widest font-extrabold opacity-50">Parallel Agents</span>
          </div>
        </div>

        <div className="sidebar-section mt-4">
          <div className="project-section-title flex items-center justify-between mb-2">
            <span className="eyebrow">Projects</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onAddProject}
              disabled={busy}
              title="Add project"
            >
              <FolderPlus size={14} />
            </Button>
          </div>
          <div className="space-y-1">
            {repos.length === 0 ? (
              <div className="empty-mini px-2 py-4 text-xs opacity-50">
                {loading ? "Loading projects..." : "No projects yet"}
              </div>
            ) : (
              repos.map((repo) => (
                <Button
                  key={repo.id}
                  variant={!settingsActive && repo.id === selectedRepoId ? "secondary" : "ghost"}
                  className={`w-full justify-start gap-2 h-9 text-sm font-medium transition-all ${
                    !settingsActive && repo.id === selectedRepoId ? "bg-secondary shadow-sm" : "opacity-70 hover:opacity-100"
                  }`}
                  onClick={() => onSelectRepo(repo.id)}
                >
                  <FolderGit2 size={16} className={!settingsActive && repo.id === selectedRepoId ? "text-primary" : ""} />
                  <span className="truncate">{repo.name}</span>
                </Button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <TaskQuickAccessPanel
          tasks={tasks}
          taskAttention={taskAttention}
          selectedTaskId={selectedTaskId}
          onOpenTask={onOpenTask}
          onStopSession={onStopSession}
        />
        <Button
          type="button"
          variant={settingsActive ? "secondary" : "ghost"}
          className={`w-full justify-start gap-2 h-9 text-sm font-medium ${
            settingsActive ? "bg-secondary shadow-sm" : "opacity-70 hover:opacity-100"
          }`}
          onClick={onOpenSettings}
        >
          <Settings size={16} className={settingsActive ? "text-primary" : ""} />
          <span>Settings</span>
        </Button>
      </div>
    </aside>
  );
}
