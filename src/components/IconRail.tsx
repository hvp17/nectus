import { FolderGit2, GitPullRequest, Plus, Radio, Search, Settings, SquareKanban } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import type { AppView } from "../store/slices/navigationSlice";

export type RailView = Exclude<AppView, "workspace">;

interface IconRailProps {
  active: RailView;
  needsCount: number;
  onNavigate: (view: RailView) => void;
  /** Open the New Task composer from anywhere — including an open task's terminal. */
  onCreateTask: () => void;
  /** A task needs a project; disable the create action until one is added. */
  canCreateTask: boolean;
  /** Open the ⌘K command palette. */
  onOpenPalette?: () => void;
}

const NAV: Array<{ id: Exclude<RailView, "settings">; label: string; Icon: typeof Radio }> = [
  { id: "mission", label: "Mission Control", Icon: Radio },
  { id: "board", label: "Board", Icon: SquareKanban },
  { id: "jira", label: "JIRA Board", Icon: FolderGit2 },
  { id: "reviews", label: "PR Reviews", Icon: GitPullRequest },
];

/**
 * The always-collapsed primary rail: icon-only, with a tooltip naming each
 * destination. Every button keeps its `aria-label`, so the accessible name (and
 * the tests that find buttons by name) is unchanged even though the text is hidden.
 */
export function IconRail({ active, needsCount, onNavigate, onCreateTask, canCreateTask, onOpenPalette }: IconRailProps) {
  return (
    <nav className="nx-rail" aria-label="Primary">
      <div className="nx-rail-head">
        <div className="nx-brand-mark" aria-hidden="true">
          N
        </div>
      </div>
      <div className="nx-rail-nav">
        {onOpenPalette && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="nx-rail-btn"
                aria-label="Search (⌘K)"
                onClick={onOpenPalette}
              >
                <Search aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search · ⌘K</TooltipContent>
          </Tooltip>
        )}
        {NAV.map(({ id, label, Icon }) => (
          <Tooltip key={id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="nx-rail-btn"
                data-active={active === id}
                aria-label={label}
                aria-current={active === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon aria-hidden="true" />
                {id === "mission" && needsCount > 0 && (
                  <span className="nx-rail-badge" aria-hidden="true">
                    {needsCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span className="nx-rail-sp" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nx-rail-btn nx-rail-new"
            aria-label="Create task"
            // The Radix tooltip won't fire on a disabled trigger, so the native
            // title still surfaces the "why" when create is unavailable.
            title={canCreateTask ? undefined : "Add a project to create a task"}
            onClick={onCreateTask}
            disabled={!canCreateTask}
          >
            <Plus aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">New task</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="nx-rail-btn"
            data-active={active === "settings"}
            aria-label="Settings"
            aria-current={active === "settings" ? "page" : undefined}
            onClick={() => onNavigate("settings")}
          >
            <Settings aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    </nav>
  );
}
