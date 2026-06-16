import type { TaskAttention } from "@/sessionAttention";
import { clearTaskAttention, upsertTaskAttention } from "@/sessionAttention";
import type { ChatMessage, ChatMessageEvent, TaskSummary } from "@/types";
import {
  chatActivityLine,
  chatPermissionAttention,
  isChatAgentWorking,
} from "./chatActivityLine";

export interface ChatRuntimeStore {
  liveLines: Record<number, string>;
  chatWorkingTaskIds: Record<number, true>;
  taskAttention: TaskAttention[];
  setLiveLines: (
    value:
      | Record<number, string>
      | ((current: Record<number, string>) => Record<number, string>),
  ) => void;
  setChatWorkingTaskIds: (
    value:
      | Record<number, true>
      | ((current: Record<number, true>) => Record<number, true>),
  ) => void;
  setTaskAttention: (
    value: TaskAttention[] | ((current: TaskAttention[]) => TaskAttention[]),
  ) => void;
}

/**
 * Mirror ACP chat streaming into the shell's ephemeral runtime sinks:
 * `liveLines`, working-state for triage, and permission attention.
 */
export function applyChatRuntimeUpdate(
  store: ChatRuntimeStore,
  payload: ChatMessageEvent,
  task: TaskSummary | undefined,
  allMessages: ChatMessage[],
) {
  const { taskId, message, done } = payload;
  const working = isChatAgentWorking(allMessages);

  store.setChatWorkingTaskIds((current) => {
    if (working) {
      if (current[taskId]) return current;
      return { ...current, [taskId]: true };
    }
    if (!(taskId in current)) return current;
    const next = { ...current };
    delete next[taskId];
    return next;
  });

  if (message.role === "agent") {
    const line = chatActivityLine(message);
    if (line) {
      store.setLiveLines((current) =>
        current[taskId] === line ? current : { ...current, [taskId]: line },
      );
    } else if (done) {
      store.setLiveLines((current) => {
        if (!(taskId in current)) return current;
        const next = { ...current };
        delete next[taskId];
        return next;
      });
    }

    const permission = chatPermissionAttention(message);
    if (task && permission) {
      store.setTaskAttention((current) =>
        upsertTaskAttention(current, {
          taskId,
          kind: "needs_input",
          title: task.title,
          agentName: task.agentName,
          reason: permission.title,
          prompt: permission.prompt,
          updatedAt: message.createdAt,
        }),
      );
    } else if (done && task) {
      store.setTaskAttention((current) => clearTaskAttention(current, taskId));
    }
  }
}

export function clearChatRuntimeForTask(store: ChatRuntimeStore, taskId: number) {
  store.setChatWorkingTaskIds((current) => {
    if (!(taskId in current)) return current;
    const next = { ...current };
    delete next[taskId];
    return next;
  });
  store.setLiveLines((current) => {
    if (!(taskId in current)) return current;
    const next = { ...current };
    delete next[taskId];
    return next;
  });
  store.setTaskAttention((current) => clearTaskAttention(current, taskId));
}
