import { FolderGit2, GitPullRequest, Plus, Radio, Search, Settings, SquareKanban } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { cn } from "../lib/utils";
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

/** Shared rail button: icon-only ghost row with the active tint + left indicator bar. */
const RAIL_BTN = cn(
  "relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground transition-colors duration-150",
  "hover:bg-foreground/5 hover:text-foreground [&>svg]:size-[18px] [&>svg]:flex-none",
  "data-[active=true]:bg-primary/15 data-[active=true]:text-primary",
  // Active indicator: a 3px bar hugging the rail's left edge (inside its padding).
  "before:absolute before:inset-y-2 before:-left-2.5 before:w-[3px] before:rounded-r-[3px] before:content-[''] data-[active=true]:before:bg-primary",
);

/**
 * The always-collapsed primary rail: icon-only, with a tooltip naming each
 * destination. Every button keeps its `aria-label`, so the accessible name (and
 * the tests that find buttons by name) is unchanged even though the text is hidden.
 */
export function IconRail({ active, needsCount, onNavigate, onCreateTask, canCreateTask, onOpenPalette }: IconRailProps) {
  return (
    <nav
      className="flex h-full min-h-0 flex-col items-stretch gap-0.5 self-stretch border-r border-sidebar-border bg-sidebar px-2.5 py-3"
      aria-label="Primary"
    >
      <div className="mb-2.5 flex items-center justify-center py-0.5">
        <div
          className="grid size-[30px] flex-none place-items-center rounded-md bg-sidebar-primary text-[15px] font-extrabold tracking-[-0.02em] text-sidebar-primary-foreground"
          aria-hidden="true"
        >
          N
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {onOpenPalette && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={RAIL_BTN}
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
                className={RAIL_BTN}
                data-active={active === id}
                aria-label={label}
                aria-current={active === id ? "page" : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon aria-hidden="true" />
                {id === "mission" && needsCount > 0 && (
                  <span
                    className="absolute top-[3px] right-[5px] grid h-4 min-w-4 place-items-center rounded-full bg-status-warning px-1 text-[10px] font-extrabold text-[color-mix(in_oklch,var(--status-warning)_30%,black)] data-[tone=running]:bg-primary"
                    aria-hidden="true"
                  >
                    {needsCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span className="flex-1" />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cn(
              RAIL_BTN,
              // The global "New task" action: a muted bordered create row, distinct
              // from the ghost nav rows above.
              "border border-border text-muted-foreground",
              "disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
            )}
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
            className={RAIL_BTN}
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
