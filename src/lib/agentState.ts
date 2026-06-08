import { getTaskAttention, formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { REVIEW_LOOP_STATUS_LABELS } from "../statusLabels";
import type { TaskSummary } from "../types";

/**
 * Cross-project attention vocabulary for the reimagined Mission Control + board.
 * A single derived state per task drives ordering, rail colour, and inline action
 * everywhere a task surfaces, so "the same concept is the same hue" holds across views.
 */
export type AgentState = "needs_you" | "running" | "review" | "done" | "idle";

export interface AgentStateMeta {
  label: string;
  /** CSS colour token for the state dot / rail. */
  dot: string;
}

export const AGENT_STATE_META: Record<AgentState, AgentStateMeta> = {
  needs_you: { label: "Needs you", dot: "var(--status-warning)" },
  running: { label: "Running", dot: "var(--primary)" },
  review: { label: "Review", dot: "var(--status-info)" },
  done: { label: "Done", dot: "var(--status-success)" },
  idle: { label: "Idle", dot: "var(--muted-foreground)" },
};

/** Triage priority — lower sorts first (most urgent on top). */
export const AGENT_STATE_ORDER: AgentState[] = ["needs_you", "running", "review", "done", "idle"];

// The "in flight" states — an agent has a live session, is blocked on you, or is
// running a review (terminal done/idle excluded). Shared so the running-agents
// flyout, Mission Control's summary pills, and any future "active" surface agree
// on what counts as active, in AGENT_STATE_ORDER priority.
export const ACTIVE_AGENT_STATES: AgentState[] = ["needs_you", "running", "review"];

// Every review-loop status counts as the "review" state, so the rail colour and
// the TaskCard review badge always agree. Driving the set from the label map
// keeps it exhaustive: a newly added ReviewLoopStatus can't silently fall
// through to "idle".
const REVIEW_STATUSES = new Set<string>(Object.keys(REVIEW_LOOP_STATUS_LABELS));

export function deriveAgentState(task: TaskSummary, attention?: TaskAttention): AgentState {
  // The live push (`attention`) reflects an in-session "needs you" immediately;
  // `task.attention` is the backend-persisted copy that survives reload. Either
  // means the agent is blocked on the user.
  if (attention?.kind === "needs_input" || task.attention === "needs_input") return "needs_you";
  if (task.activeSessionId) return "running";
  if (task.reviewLoopStatus && REVIEW_STATUSES.has(task.reviewLoopStatus)) return "review";
  if (task.status === "review") return "review";
  if (task.status === "done") return "done";
  if (attention?.kind === "idle") return "idle";
  return "idle";
}

/** The agent's latest meaningful line — its question, status, or last result. */
export function deriveAgentLine(task: TaskSummary, state: AgentState, attention?: TaskAttention): string {
  if (state === "needs_you") {
    return attention?.prompt?.trim() || formatAttentionReason(attention?.reason);
  }
  if (state === "review") {
    return task.reviewLoopStatus ? REVIEW_LOOP_STATUS_LABELS[task.reviewLoopStatus] : "In review";
  }
  if (state === "done") {
    return task.prUrl ? "Pull request opened" : "Marked done";
  }
  if (state === "idle") {
    return attention?.message?.trim() || (task.lastSessionId ? "Last session saved" : "No active session");
  }
  // running
  return task.lastSessionLabel?.trim() || "Session running";
}

const TIME_UNITS: Array<[number, string]> = [
  [60_000, "m"],
  [3_600_000, "h"],
  [86_400_000, "d"],
];

/** Compact relative elapsed time (e.g. "4m", "2h", "3d") since the task last changed. */
export function elapsedSince(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const delta = Math.max(0, now - then);
  if (delta < TIME_UNITS[0][0]) return "now";
  if (delta < TIME_UNITS[1][0]) return `${Math.floor(delta / TIME_UNITS[0][0])}m`;
  if (delta < TIME_UNITS[2][0]) return `${Math.floor(delta / TIME_UNITS[1][0])}h`;
  return `${Math.floor(delta / TIME_UNITS[2][0])}d`;
}

export interface AgentRow {
  task: TaskSummary;
  state: AgentState;
  line: string;
  elapsed: string;
  repoName: string;
  attention?: TaskAttention;
}

/** Build the cross-project, attention-ordered list that powers Mission Control. */
export function buildAgentRows(
  tasks: TaskSummary[],
  taskAttention: TaskAttention[],
  repoNames: Map<number, string>,
  liveLines: Record<number, string> = {},
  now = Date.now(),
): AgentRow[] {
  return tasks
    .map((task) => {
      const attention = getTaskAttention(taskAttention, task.id);
      const state = deriveAgentState(task, attention);
      // A running session's live activity line, when we have one, beats the
      // static "Session running" / label fallback.
      const liveLine = state === "running" ? liveLines[task.id]?.trim() : undefined;
      return {
        task,
        state,
        attention,
        line: liveLine || deriveAgentLine(task, state, attention),
        elapsed: elapsedSince(task.updatedAt, now),
        repoName: repoNames.get(task.repoId) ?? "project",
      };
    })
    .sort((a, b) => {
      const order = AGENT_STATE_ORDER.indexOf(a.state) - AGENT_STATE_ORDER.indexOf(b.state);
      if (order !== 0) return order;
      return b.task.updatedAt.localeCompare(a.task.updatedAt);
    });
}
