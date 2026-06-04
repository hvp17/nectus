import { FolderGit2, GitPullRequest, Radio, Settings, SquareKanban } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type RailView = "mission" | "board" | "jira" | "reviews" | "settings";

interface IconRailProps {
  active: RailView;
  needsCount: number;
  onNavigate: (view: RailView) => void;
}

const NAV: Array<{ id: Exclude<RailView, "settings">; label: string; Icon: typeof Radio }> = [
  { id: "mission", label: "Mission Control", Icon: Radio },
  { id: "board", label: "Board", Icon: SquareKanban },
  { id: "jira", label: "JIRA Board", Icon: FolderGit2 },
  { id: "reviews", label: "PR Reviews", Icon: GitPullRequest },
];

export function IconRail({ active, needsCount, onNavigate }: IconRailProps) {
  return (
    <nav className="nx-rail" aria-label="Primary">
      <div className="nx-brand-mark" aria-hidden="true">
        N
      </div>
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
          <TooltipContent side="right" className="text-xs">
            {label}
            {id === "mission" && needsCount > 0 ? ` · ${needsCount} need you` : ""}
          </TooltipContent>
        </Tooltip>
      ))}
      <span className="nx-rail-sp" />
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
        <TooltipContent side="right" className="text-xs">
          Settings
        </TooltipContent>
      </Tooltip>
    </nav>
  );
}
