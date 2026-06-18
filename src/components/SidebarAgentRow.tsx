import { GitBranch } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import { cn } from "../lib/utils";
import type { AgentRow } from "../lib/agentState";
import type { AgentKind } from "../types";

/**
 * One in-flight agent, rendered as a compact card in the sidebar's nested agent
 * lists. Shares the visual vocabulary the old running-agents popup used (state
 * rail, mono location line, live dot), so "the same concept is the same hue"
 * still holds. Clicking focuses the task.
 */
export function SidebarAgentRow({ row, onOpen }: { row: AgentRow; onOpen: () => void }) {
  const { task, state, line, elapsed, repoName } = row;
  const agentKind: AgentKind = task.agentKind ?? "custom";
  return (
    <button
      type="button"
      className={cn(
        "group relative flex w-full cursor-pointer flex-col gap-[3px] overflow-hidden rounded-md bg-card py-[9px] pr-[11px] pl-[13px] text-left",
        "ring-1 ring-border transition-shadow duration-150 hover:shadow-xs hover:ring-primary/45",
        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
        // Left state rail: a 3px stripe colored by the row's attention state.
        "before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-['']",
        "data-[state=needs_you]:before:bg-status-warning data-[state=running]:before:bg-primary data-[state=review]:before:bg-status-info data-[state=finished]:before:bg-status-success",
      )}
      data-state={state}
      onClick={onOpen}
      aria-label={`Open ${task.title} (${repoName})`}
    >
      <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-semibold text-muted-foreground">
        <span className="flex min-w-0 flex-1 items-center gap-[5px]">
          <AgentLogo agentKind={agentKind} size="xs" />
          <span className="truncate text-foreground">{repoName}</span>
          {task.hasWorktree && task.branchName && (
            <>
              <GitBranch aria-hidden="true" className="size-2.5 flex-none opacity-70" />
              <span className="truncate" data-testid="agent-branch">
                {task.branchName}
              </span>
            </>
          )}
        </span>
        {state === "running" && (
          <span
            className="size-[7px] shrink-0 animate-pulse rounded-full bg-primary"
            data-testid="live-dot"
            aria-hidden="true"
          />
        )}
        {elapsed && <span className="flex-none font-mono text-[10.5px] text-muted-foreground">{elapsed}</span>}
      </div>
      <div className="truncate text-[12.5px] leading-[1.3] font-semibold">{task.title}</div>
      <div className="truncate font-mono text-[11px] text-muted-foreground group-data-[state=needs_you]:text-status-warning">
        {state === "needs_you" ? `“${line}”` : line}
      </div>
    </button>
  );
}
