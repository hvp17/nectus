import { GitBranch } from "lucide-react";
import { AgentLogo } from "./AgentBrand";
import type { AgentRow } from "../lib/agentState";
import type { AgentKind } from "../types";

/**
 * One in-flight agent, rendered as a compact card in the sidebar's nested agent
 * lists. Shares the `nx-fly-row*` vocabulary that the old running-agents popup
 * used, so "the same concept is the same hue" still holds. Clicking focuses the task.
 */
export function SidebarAgentRow({ row, onOpen }: { row: AgentRow; onOpen: () => void }) {
  const { task, state, line, elapsed, repoName } = row;
  const agentKind: AgentKind = task.agentKind ?? "custom";
  return (
    <button
      type="button"
      className="nx-fly-row"
      data-state={state}
      onClick={onOpen}
      aria-label={`Open ${task.title} (${repoName})`}
    >
      <div className="nx-fly-row-top">
        <span className="nx-fly-loc">
          <AgentLogo agentKind={agentKind} size="xs" />
          <span className="nx-fly-proj">{repoName}</span>
          {task.hasWorktree && task.branchName && (
            <>
              <GitBranch aria-hidden="true" />
              <span className="nx-fly-branch">{task.branchName}</span>
            </>
          )}
        </span>
        {state === "running" && <span className="nx-livedot live-dot" aria-hidden="true" />}
        {elapsed && <span className="nx-fly-time">{elapsed}</span>}
      </div>
      <div className="nx-fly-row-title">{task.title}</div>
      <div className="nx-fly-row-line">{state === "needs_you" ? `“${line}”` : line}</div>
    </button>
  );
}
