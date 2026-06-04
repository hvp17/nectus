import { FolderGit2, Plus } from "lucide-react";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import type { Repo, TaskSummary } from "../types";

interface ProjectPanelProps {
  repos: Repo[];
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  selectedRepoId?: number;
  onSelectRepo: (id: number) => void;
  onAddProject: () => void;
  busy: boolean;
  loading: boolean;
}

export function ProjectPanel({
  repos,
  tasks,
  taskAttention,
  selectedRepoId,
  onSelectRepo,
  onAddProject,
  busy,
  loading,
}: ProjectPanelProps) {
  return (
    <aside className="nx-panel" aria-label="Projects">
      <div className="nx-panel-head">Nectus</div>
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
            repos.map((repo) => {
              const repoTasks = tasks.filter((task) => task.repoId === repo.id);
              const needsAttention = repoTasks.some(
                (task) => getTaskAttention(taskAttention, task.id)?.kind === "needs_input",
              );
              return (
                <button
                  key={repo.id}
                  type="button"
                  className="nx-proj"
                  data-active={repo.id === selectedRepoId}
                  onClick={() => onSelectRepo(repo.id)}
                >
                  <FolderGit2 aria-hidden="true" />
                  <span className="nx-proj-name">{repo.name}</span>
                  {needsAttention ? (
                    <span className="nx-proj-attn" aria-label="Task needs input" />
                  ) : (
                    <span className="nx-proj-count">{repoTasks.length}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
