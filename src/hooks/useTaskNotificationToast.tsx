import { useEffect } from "react";
import { toast } from "sonner";
import { AgentLogo } from "../components/AgentBrand";
import type { TaskToast } from "../taskNotification";

interface UseTaskNotificationToastParams {
  notification: TaskToast | null;
  onOpenTask: (taskId: number) => void;
  onShown: () => void;
}

// Surfaces a task attention notification as a sonner toast whose "Open task"
// action focuses that task's workspace. OS notifications cannot be made
// clickable on desktop (the plugin's desktop show() is fire-and-forget), so the
// in-app toast is the navigable surface. The toast's icon is the provider logo
// (Claude/Codex/Gemini/OpenCode) so you can tell at a glance which agent the update is from.
export function useTaskNotificationToast({
  notification,
  onOpenTask,
  onShown,
}: UseTaskNotificationToastParams) {
  useEffect(() => {
    if (!notification) return;

    const { taskId, title, body, kind, agentKind } = notification;
    toast[kind](title, {
      description: body,
      duration: 8000,
      icon: <AgentLogo agentKind={agentKind} size="md" />,
      action: {
        label: "Open task",
        onClick: () => onOpenTask(taskId),
      },
    });
    onShown();
  }, [notification, onOpenTask, onShown]);
}
