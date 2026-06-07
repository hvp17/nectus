import type { ReactNode } from "react";
import { FolderGit2, GitPullRequest, Plus, Radio, Settings, SquareKanban } from "lucide-react";

export type RailView = "mission" | "board" | "jira" | "reviews" | "settings";

interface IconRailProps {
  active: RailView;
  needsCount: number;
  onNavigate: (view: RailView) => void;
  /** Open the New Task composer from anywhere — including an open task's terminal. */
  onCreateTask: () => void;
  /** A task needs a project; disable the create action until one is added. */
  canCreateTask: boolean;
  /** Quick-access running-agents trigger, rendered with the primary nav group. */
  runningAgentsSlot?: ReactNode;
}

const NAV: Array<{ id: Exclude<RailView, "settings">; label: string; Icon: typeof Radio }> = [
  { id: "mission", label: "Mission Control", Icon: Radio },
  { id: "board", label: "Board", Icon: SquareKanban },
  { id: "jira", label: "JIRA Board", Icon: FolderGit2 },
  { id: "reviews", label: "PR Reviews", Icon: GitPullRequest },
];

export function IconRail({
  active,
  needsCount,
  onNavigate,
  onCreateTask,
  canCreateTask,
  runningAgentsSlot,
}: IconRailProps) {
  return (
    <nav className="nx-rail" aria-label="Primary">
      <div className="nx-rail-head">
        <div className="nx-brand-mark" aria-hidden="true">
          N
        </div>
        <span className="nx-brand-word">Nectus</span>
      </div>
      <div className="nx-rail-nav">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="nx-rail-btn"
            data-active={active === id}
            aria-label={label}
            aria-current={active === id ? "page" : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon aria-hidden="true" />
            <span className="nx-rail-label">{label}</span>
            {id === "mission" && needsCount > 0 && (
              <span className="nx-rail-badge" aria-hidden="true">
                {needsCount}
              </span>
            )}
          </button>
        ))}
        {runningAgentsSlot}
      </div>
      <span className="nx-rail-sp" />
      <button
        type="button"
        className="nx-rail-btn nx-rail-new"
        aria-label="Create task"
        title={canCreateTask ? undefined : "Add a project to create a task"}
        onClick={onCreateTask}
        disabled={!canCreateTask}
      >
        <Plus aria-hidden="true" />
        <span className="nx-rail-label">New task</span>
      </button>
      <button
        type="button"
        className="nx-rail-btn"
        data-active={active === "settings"}
        aria-label="Settings"
        aria-current={active === "settings" ? "page" : undefined}
        onClick={() => onNavigate("settings")}
      >
        <Settings aria-hidden="true" />
        <span className="nx-rail-label">Settings</span>
      </button>
    </nav>
  );
}
