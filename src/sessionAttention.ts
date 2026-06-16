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
  attention: TaskAttention,
): TaskAttention[] {
  return [...current.filter((item) => item.taskId !== attention.taskId), attention];
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
