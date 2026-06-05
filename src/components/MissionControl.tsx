import { CheckCheck, GitBranch, GitPullRequest, MessageSquareReply, RefreshCw, Radio, Terminal } from "lucide-react";
import { Button } from "./ui/button";
import { AgentLogo } from "./AgentBrand";
import {
  AGENT_STATE_META,
  AGENT_STATE_ORDER,
  buildAgentRows,
  type AgentRow,
  type AgentState,
} from "../lib/agentState";
import type { TaskAttention } from "../sessionAttention";
import type { AgentKind, Repo, TaskSummary } from "../types";

interface MissionControlProps {
  repos: Repo[];
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  loading: boolean;
  onOpenTask: (taskId: number) => void;
  onOpenPr: (url: string) => void;
  onRefresh: () => void;
}

// Groups shown in the triage inbox, most-urgent first.
const GROUPS: AgentState[] = AGENT_STATE_ORDER;
// Summary pills mirror the four active states.
const SUMMARY: AgentState[] = ["needs_you", "running", "review", "done"];

export function MissionControl({
  repos,
  tasks,
  taskAttention,
  loading,
  onOpenTask,
  onOpenPr,
  onRefresh,
}: MissionControlProps) {
  const repoNames = new Map(repos.map((repo) => [repo.id, repo.name]));
  const rows = buildAgentRows(tasks, taskAttention, repoNames);
  const byState = (state: AgentState) => rows.filter((row) => row.state === state);
  const count = (state: AgentState) => byState(state).length;

  return (
    <main className="nx-main">
      <div className="nx-head-row">
        <div>
          <h1 className="nx-h1">Mission Control</h1>
          <p className="nx-sub">Every agent across all projects, ordered by who needs you.</p>
        </div>
        <div className="nx-head-actions">
          <Button variant="outline" size="sm" onClick={onRefresh} title="Refresh">
            <RefreshCw data-icon="inline-start" className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="nx-summary">
        {SUMMARY.map((state) => (
          <span key={state} className="nx-sum" data-tone={state === "needs_you" ? "warning" : undefined}>
            <span className="nx-dot" style={{ background: AGENT_STATE_META[state].dot }} />
            {AGENT_STATE_META[state].label}
            <b>{count(state)}</b>
          </span>
        ))}
      </div>

      <div className="nx-scroll">
        {rows.length === 0 ? (
          <div className="nx-empty-mission">
            <span className="nx-em-ic">
              <Radio size={20} aria-hidden="true" />
            </span>
            <h4>{loading ? "Loading agents…" : "No agents yet"}</h4>
            <p>
              {loading
                ? "Reading tasks across your projects."
                : "Create a task in any project and Mission Control will track it here."}
            </p>
          </div>
        ) : (
          GROUPS.map((state) => (
            <AttentionGroup
              key={state}
              state={state}
              rows={byState(state)}
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
      <div className="nx-group-head">
        <span className="nx-dot" style={{ background: meta.dot }} />
        <span className="nx-gl" style={{ color: meta.dot }}>
          {meta.label}
        </span>
        <span className="nx-gc">{rows.length}</span>
        <span className="nx-rule" />
      </div>
      <div className="nx-rows">
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
      className="nx-row"
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
      <div className="nx-row-left">
        <span className="nx-row-loc">
          <span className="nx-proj-label">{repoName}</span>
          {task.hasWorktree && task.branchName && (
            <>
              <span aria-hidden="true">·</span>
              <GitBranch aria-hidden="true" />
              <span className="nx-branch">{task.branchName}</span>
            </>
          )}
        </span>
        <span className="nx-row-agent">
          <AgentLogo agentKind={agentKind} size="xs" />
          {task.agentName ?? "Agent"}
        </span>
      </div>

      <div className="nx-row-mid">
        <div className="nx-row-title">{task.title}</div>
        <div className="nx-row-line">{state === "needs_you" ? `“${line}”` : line}</div>
      </div>

      <div className="nx-row-right">
        {state === "running" && (
          <span className="nx-row-agent">
            <span className="nx-livedot live-dot" />
            live
          </span>
        )}
        {elapsed && <span className="nx-row-time">{elapsed}</span>}
        <div
          className="nx-row-actions"
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
        <Terminal data-icon="inline-start" />
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
