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

function agentName(task: TaskSummary) {
  return task.agentName ?? "Codex";
}

function agentKind(task: TaskSummary): AgentKind {
  return task.agentKind ?? "custom";
}

export function taskFinishedToast(task: TaskSummary, payload: SessionIdleEvent): TaskToast {
  const detail = payload.message ? ` ${payload.message}` : "";
  return {
    taskId: task.id,
    title: `${agentName(task)} finished`,
    body: formatNotificationBody(`${task.title}${detail}`),
    kind: "success",
    agentKind: agentKind(task),
  };
}

export function taskNeedsInputToast(task: TaskSummary, payload: SessionNeedsInputEvent): TaskToast {
  const reason = payload.reason ? ` (${payload.reason})` : "";
  const prompt = payload.prompt ? `: ${payload.prompt}` : "";
  return {
    taskId: task.id,
    title: `${agentName(task)} needs input`,
    body: formatNotificationBody(`${task.title}${reason}${prompt}`),
    kind: "info",
    agentKind: agentKind(task),
  };
}
