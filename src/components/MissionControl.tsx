import { useMemo } from "react";
import { CheckCheck, GitBranch, GitPullRequest, MessageSquareReply, Radio, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { AgentLogo } from "./AgentBrand";
import { useMinuteNow } from "../hooks/useMinuteNow";
import {
  ACTIVE_AGENT_STATES,
  AGENT_STATE_META,
  AGENT_STATE_ORDER,
  buildAgentRows,
  type AgentRow,
  type AgentState,
} from "../lib/agentState";
import { cn } from "../lib/utils";
import type { TaskAttention } from "../sessionAttention";
import type { AgentKind, Repo, TaskSummary } from "../types";

interface MissionControlProps {
  repos: Repo[];
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  liveLines: Record<number, string>;
  chatWorkingTaskIds: Record<number, true>;
  loading: boolean;
  onOpenTask: (taskId: number) => void;
  onOpenPr: (url: string) => void;
  onRefresh: () => void;
}

// Groups shown in the triage inbox, most-urgent first.
const GROUPS: AgentState[] = AGENT_STATE_ORDER;
// Summary pills mirror the in-flight states plus completed work.
const SUMMARY: AgentState[] = [...ACTIVE_AGENT_STATES, "done"];

export function MissionControl({
  repos,
  tasks,
  taskAttention,
  liveLines,
  chatWorkingTaskIds,
  loading,
  onOpenTask,
  onOpenPr,
  onRefresh,
}: MissionControlProps) {
  const now = useMinuteNow();

  const repoNames = useMemo(() => new Map(repos.map((repo) => [repo.id, repo.name])), [repos]);
  const rows = useMemo(
    () => buildAgentRows(tasks, taskAttention, repoNames, liveLines, now, chatWorkingTaskIds),
    [tasks, taskAttention, repoNames, liveLines, now, chatWorkingTaskIds],
  );
  // Bucket once instead of re-filtering the row list for every pill and group.
  const rowsByState = useMemo(() => {
    const grouped = Object.fromEntries(AGENT_STATE_ORDER.map((state) => [state, [] as AgentRow[]])) as Record<
      AgentState,
      AgentRow[]
    >;
    for (const row of rows) grouped[row.state].push(row);
    return grouped;
  }, [rows]);
  const count = (state: AgentState) => rowsByState[state].length;

  return (
    <main className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden px-6 py-[22px]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Mission Control</h1>
          <p className="mt-[3px] text-[13px] text-muted-foreground">
            Every agent across all projects, ordered by who needs you.
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} title="Refresh">
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mb-[18px] flex flex-wrap gap-2">
        {SUMMARY.map((state) => (
          <span
            key={state}
            data-tone={state === "needs_you" ? "warning" : undefined}
            className={cn(
              "inline-flex h-[30px] items-center gap-2 rounded-full border border-border bg-card pr-3 pl-[11px] text-xs font-semibold text-muted-foreground",
              state === "needs_you" && "border-status-warning/40 bg-status-warning/[0.09]",
            )}
          >
            <span className="size-2 rounded-full" style={{ background: AGENT_STATE_META[state].dot }} />
            {AGENT_STATE_META[state].label}
            <b
              className={cn(
                "text-foreground tabular-nums",
                state === "needs_you" &&
                  "text-[color-mix(in_oklch,var(--status-warning)_60%,black)] dark:text-[color-mix(in_oklch,var(--status-warning)_75%,white)]",
              )}
            >
              {count(state)}
            </b>
          </span>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-x-hidden overflow-y-auto pr-0.5">
        {rows.length === 0 ? (
          <Empty className="text-muted-foreground">
            <EmptyHeader>
              <EmptyMedia
                variant="icon"
                className="size-[46px] rounded-lg border border-border bg-card text-muted-foreground"
              >
                <Radio className="size-5" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle className="text-[15px] font-bold text-foreground">
                {loading ? "Loading agents…" : "No agents yet"}
              </EmptyTitle>
              <EmptyDescription className="max-w-[38ch] text-[12.5px]">
                {loading
                  ? "Reading tasks across your projects."
                  : "Create a task in any project and Mission Control will track it here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          GROUPS.map((state) => (
            <AttentionGroup
              key={state}
              state={state}
              rows={rowsByState[state]}
              onOpenTask={onOpenTask}
              onOpenPr={onOpenPr}
            />
          ))
        )}
      </div>
    </main>
  );
}

function AttentionGroup({
  state,
  rows,
  onOpenTask,
  onOpenPr,
}: {
  state: AgentState;
  rows: AgentRow[];
  onOpenTask: (taskId: number) => void;
  onOpenPr: (url: string) => void;
}) {
  if (rows.length === 0) return null;
  const meta = AGENT_STATE_META[state];
  return (
    <section>
      <div className="mb-2 flex items-center gap-[9px]">
        <span className="size-2 rounded-full" style={{ background: meta.dot }} />
        <span className="text-[11px] font-extrabold tracking-[0.08em] uppercase" style={{ color: meta.dot }}>
          {meta.label}
        </span>
        <span className="font-mono text-[11px] font-semibold text-muted-foreground">{rows.length}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <AttentionRow key={row.task.id} row={row} onOpenTask={onOpenTask} onOpenPr={onOpenPr} />
        ))}
      </div>
    </section>
  );
}

function AttentionRow({
  row,
  onOpenTask,
  onOpenPr,
}: {
  row: AgentRow;
  onOpenTask: (taskId: number) => void;
  onOpenPr: (url: string) => void;
}) {
  const { task, state, line, elapsed, repoName } = row;
  const agentKind: AgentKind = task.agentKind ?? "custom";
  const open = () => onOpenTask(task.id);

  return (
    <div
      className={cn(
        "relative grid w-full cursor-pointer grid-cols-[minmax(132px,auto)_minmax(0,1fr)_auto] items-center gap-3.5 overflow-hidden rounded-lg bg-card py-[13px] pr-[15px] pl-[17px] text-left shadow-xs ring-1 ring-border transition-shadow hover:shadow-sm hover:ring-primary/45",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] data-[state=needs_you]:before:bg-status-warning data-[state=running]:before:bg-primary data-[state=review]:before:bg-status-info data-[state=done]:before:bg-status-success",
      )}
      data-state={state}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="flex min-w-0 flex-col gap-[5px]">
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] font-semibold text-muted-foreground">
          <span className="truncate text-foreground">{repoName}</span>
          {task.hasWorktree && task.branchName && (
            <>
              <span aria-hidden="true">·</span>
              <GitBranch aria-hidden="true" className="size-[11px] flex-none opacity-70" />
              <span className="truncate">{task.branchName}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
          <AgentLogo agentKind={agentKind} size="xs" />
          {task.agentName ?? "Agent"}
        </span>
      </div>

      <div className="min-w-0">
        <div className="truncate text-[13.5px] leading-[1.3] font-semibold">{task.title}</div>
        <div
          className={cn(
            "mt-[3px] truncate font-mono text-[11.5px] text-muted-foreground",
            state === "needs_you" && "text-[color-mix(in_oklch,var(--status-warning)_55%,var(--foreground))]",
          )}
        >
          {state === "needs_you" ? `“${line}”` : line}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2.5">
        {state === "running" && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-primary" />
            live
          </span>
        )}
        {elapsed && <span className="min-w-[26px] text-right font-mono text-[11px] text-muted-foreground">{elapsed}</span>}
        <div
          className="flex gap-1.5"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <RowActions state={state} task={task} onOpenTask={onOpenTask} onOpenPr={onOpenPr} />
        </div>
      </div>
    </div>
  );
}

function RowActions({
  state,
  task,
  onOpenTask,
  onOpenPr,
}: {
  state: AgentState;
  task: TaskSummary;
  onOpenTask: (taskId: number) => void;
  onOpenPr: (url: string) => void;
}) {
  if (state === "needs_you") {
    return (
      <Button size="sm" onClick={() => onOpenTask(task.id)}>
        <MessageSquareReply data-icon="inline-start" />
        Respond
      </Button>
    );
  }
  if (state === "running") {
    return (
      <Button size="sm" variant="outline" onClick={() => onOpenTask(task.id)}>
        <MessageSquareReply data-icon="inline-start" />
        Open
      </Button>
    );
  }
  if (state === "review") {
    return (
      <Button size="sm" variant="outline" onClick={() => onOpenTask(task.id)}>
        <CheckCheck data-icon="inline-start" />
        Review
      </Button>
    );
  }
  if (state === "done" && task.prUrl) {
    return (
      <Button size="sm" variant="ghost" onClick={() => task.prUrl && onOpenPr(task.prUrl)}>
        <GitPullRequest data-icon="inline-start" />
        PR
      </Button>
    );
  }
  return (
    <Button size="sm" variant="ghost" onClick={() => onOpenTask(task.id)}>
      Open
    </Button>
  );
}
