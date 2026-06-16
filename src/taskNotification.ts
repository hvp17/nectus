import type { AgentKind } from "./types";

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
