import { formatNotificationBody } from "./notificationText";
import type { AgentKind, SessionIdleEvent, SessionNeedsInputEvent, TaskSummary } from "./types";

// An attention notification tied to a specific task. Rendered as a sonner toast
// whose action navigates to the task workspace (see useTaskNotificationToast).
// `agentKind` selects the provider logo shown as the toast's icon.
export interface TaskToast {
  taskId: number;
  title: string;
  body: string;
  kind: "success" | "info";
  agentKind: AgentKind;
}

function agentName(task: TaskSummary | undefined) {
  return task?.agentName ?? "Codex";
}

function agentKind(task: TaskSummary): AgentKind {
  return task.agentKind ?? "custom";
}

/**
 * The title + body for a session attention event. The single source of truth for
 * this wording, shared by the in-app toast, the OS notification, and the no-task
 * fallback message (see useEventBridge) so the three renderings never drift.
 * `task` may be undefined when the event arrives before its task is cached.
 */
export function sessionIdleContent(task: TaskSummary | undefined, payload: SessionIdleEvent) {
  const detail = payload.message ? ` ${payload.message}` : "";
  return { title: `${agentName(task)} finished`, body: `${task?.title ?? "task is waiting"}${detail}` };
}

export function sessionNeedsInputContent(task: TaskSummary | undefined, payload: SessionNeedsInputEvent) {
  const reason = payload.reason ? ` (${payload.reason})` : "";
  const prompt = payload.prompt ? `: ${payload.prompt}` : "";
  return { title: `${agentName(task)} needs input`, body: `${task?.title ?? "a task"}${reason}${prompt}` };
}

export function taskFinishedToast(task: TaskSummary, payload: SessionIdleEvent): TaskToast {
  const { title, body } = sessionIdleContent(task, payload);
  return { taskId: task.id, title, body: formatNotificationBody(body), kind: "success", agentKind: agentKind(task) };
}

export function taskNeedsInputToast(task: TaskSummary, payload: SessionNeedsInputEvent): TaskToast {
  const { title, body } = sessionNeedsInputContent(task, payload);
  return { taskId: task.id, title, body: formatNotificationBody(body), kind: "info", agentKind: agentKind(task) };
}
