import type { SessionIdleEvent, SessionNeedsInputEvent, TaskSummary } from "./types";

export type TaskAttentionKind = "idle" | "needs_input";

export interface TaskAttention {
  taskId: number;
  kind: TaskAttentionKind;
  title: string;
  agentName?: string | null;
  reason?: string;
  prompt?: string | null;
  message?: string | null;
  updatedAt: string;
}

export function upsertTaskAttention(
  current: TaskAttention[],
  task: TaskSummary,
  event: SessionIdleEvent | SessionNeedsInputEvent,
  updatedAt = new Date().toISOString(),
): TaskAttention[] {
  const next: TaskAttention =
    "reason" in event
      ? {
          taskId: task.id,
          kind: "needs_input",
          title: task.title,
          agentName: task.agentName,
          reason: event.reason,
          prompt: event.prompt,
          updatedAt,
        }
      : {
          taskId: task.id,
          kind: "idle",
          title: task.title,
          agentName: task.agentName,
          message: event.message,
          updatedAt,
        };

  return [...current.filter((attention) => attention.taskId !== task.id), next];
}

export function clearTaskAttention(current: TaskAttention[], taskId: number): TaskAttention[] {
  return current.filter((attention) => attention.taskId !== taskId);
}

export function getTaskAttention(current: TaskAttention[], taskId: number): TaskAttention | undefined {
  return current.find((attention) => attention.taskId === taskId);
}

export function getAttentionCounts(current: TaskAttention[]) {
  return {
    needsInput: current.filter((attention) => attention.kind === "needs_input").length,
    finished: current.filter((attention) => attention.kind === "idle").length,
  };
}

export function formatAttentionReason(reason?: string | null): string {
  if (!reason) return "Needs input";
  return reason
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
