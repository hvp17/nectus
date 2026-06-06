import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, GitBranch } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { AgentLogo } from "./AgentBrand";
import {
  ACTIVE_AGENT_STATES,
  AGENT_STATE_META,
  buildAgentRows,
  deriveAgentState,
  type AgentRow,
} from "../lib/agentState";
import { getTaskAttention, type TaskAttention } from "../sessionAttention";
import type { AgentKind, Repo, TaskSummary } from "../types";

interface RunningAgentsFlyoutProps {
  /** Every task across all projects — the flyout is global, like the rail badge. */
  tasks: TaskSummary[];
  repos: Repo[];
  taskAttention: TaskAttention[];
  liveLines: Record<number, string>;
  onOpenTask: (taskId: number) => void;
}

/**
 * Rail-anchored quick-access popover listing every agent that is currently in
 * flight ([[ACTIVE_AGENT_STATES]]) across all projects. Reuses Mission Control's
 * row vocabulary so "the same concept is the same hue" holds here too, and
 * clicking a row focuses that task.
 */
export function RunningAgentsFlyout({
  tasks,
  repos,
  taskAttention,
  liveLines,
  onOpenTask,
}: RunningAgentsFlyoutProps) {
  const [open, setOpen] = useState(false);

  // Elapsed labels only render while the popover is open, so only tick (and force
  // the re-derive below) then — the trigger is mounted on every view all the time.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [open]);

  const repoNames = useMemo(() => new Map(repos.map((repo) => [repo.id, repo.name])), [repos]);

  // The badge is always visible, so keep its count cheap — a single pass, no sort,
  // no row/elapsed/repo allocation.
  const activeCount = useMemo(
    () =>
      tasks.reduce(
        (count, task) =>
          ACTIVE_AGENT_STATES.includes(deriveAgentState(task, getTaskAttention(taskAttention, task.id)))
            ? count + 1
            : count,
        0,
      ),
    [tasks, taskAttention],
  );

  // The full, sorted rows (live line + elapsed) are only needed while open, so skip
  // the cross-project map+sort entirely when the popover is closed.
  const activeRows = useMemo(
    () =>
      open
        ? buildAgentRows(tasks, taskAttention, repoNames, liveLines, now).filter((row) =>
            ACTIVE_AGENT_STATES.includes(row.state),
          )
        : [],
    [open, tasks, taskAttention, repoNames, liveLines, now],
  );

  // Group active rows by state so the popover renders ordered groups with headers.
  const rowsByState = useMemo(() => {
    const groups: Record<string, AgentRow[]> = {};
    for (const state of ACTIVE_AGENT_STATES) {
      groups[state] = [];
    }
    for (const row of activeRows) {
      groups[row.state]?.push(row);
    }
    return groups;
  }, [activeRows]);

  const focus = useCallback(
    (taskId: number) => {
      onOpenTask(taskId);
      setOpen(false);
    },
    [onOpenTask],
  );

  const label = `Running agents${activeCount > 0 ? ` · ${activeCount} active` : ""}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" className="nx-rail-btn" data-active={open} aria-label={label}>
              <Activity aria-hidden="true" />
              {activeCount > 0 && (
                <span className="nx-rail-badge" data-tone="running" aria-hidden="true">
                  {activeCount}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={10}
        role="region"
        aria-label="Running agents"
        className="nx-fly w-80 p-0"
      >
        <div className="nx-fly-head">
          <Activity aria-hidden="true" />
          <span className="nx-fly-title">Running agents</span>
          <span className="nx-fly-count">{activeCount}</span>
        </div>
        {activeCount === 0 ? (
          <div className="nx-fly-empty">No agents running right now.</div>
        ) : (
          <div className="nx-fly-scroll">
            {ACTIVE_AGENT_STATES.map((state) => {
              const stateRows = rowsByState[state];
              if (stateRows.length === 0) return null;
              const meta = AGENT_STATE_META[state];
              return (
                <div key={state} className="nx-fly-group">
                  <div className="nx-fly-gl" style={{ color: meta.dot }}>
                    <span className="nx-dot" style={{ background: meta.dot }} />
                    {meta.label}
                    <span className="nx-fly-gc">{stateRows.length}</span>
                  </div>
                  {stateRows.map((row) => (
                    <FlyRow key={row.task.id} row={row} onOpen={() => focus(row.task.id)} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function FlyRow({ row, onOpen }: { row: AgentRow; onOpen: () => void }) {
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
