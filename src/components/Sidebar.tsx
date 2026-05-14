import { FolderPlus, FolderGit2 } from "lucide-react";
import { Button } from "./ui/button";
import { Repo } from "../types";

interface SidebarProps {
  repos: Repo[];
  selectedRepoId?: number;
  onSelectRepo: (id: number) => void;
  onAddProject: () => void;
  busy: boolean;
  loading: boolean;
}

export function Sidebar({ repos, selectedRepoId, onSelectRepo, onAddProject, busy, loading }: SidebarProps) {
  return (
    <aside className="sidebar">
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
                variant={repo.id === selectedRepoId ? "secondary" : "ghost"}
                className={`w-full justify-start gap-2 h-9 text-sm font-medium transition-all ${
                  repo.id === selectedRepoId ? "bg-secondary shadow-sm" : "opacity-70 hover:opacity-100"
                }`}
                onClick={() => onSelectRepo(repo.id)}
              >
                <FolderGit2 size={16} className={repo.id === selectedRepoId ? "text-primary" : ""} />
                <span className="truncate">{repo.name}</span>
              </Button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
