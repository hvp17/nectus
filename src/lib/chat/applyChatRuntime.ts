import type { TaskAttention } from "@/sessionAttention";
import { clearTaskAttention, upsertTaskAttention } from "@/sessionAttention";
import type { ChatMessage, ChatMessageEvent, TaskSummary } from "@/types";
import {
  chatActivityLine,
  chatPermissionAttention,
  isChatAgentWorking,
} from "./chatActivityLine";

/** What a chat event changed, for the bridge's finish notification. */
export interface ChatRuntimeOutcome {
  /** True when this event completed an agent turn (no pending approval). */
  finished: boolean;
  /** The agent's closing line when `finished`, else null. */
  finishedLine: string | null;
}

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
 * `liveLines`, working-state for triage, and attention (pending permission →
 * `needs_input`; a completed turn → `idle`/finished). Returns what changed so the
 * event bridge can fire the finish notification.
 */
export function applyChatRuntimeUpdate(
  store: ChatRuntimeStore,
  payload: ChatMessageEvent,
  task: TaskSummary | undefined,
  allMessages: ChatMessage[],
): ChatRuntimeOutcome {
  const { taskId, message, done } = payload;
  const working = isChatAgentWorking(allMessages);
  const outcome: ChatRuntimeOutcome = { finished: false, finishedLine: null };

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
    const isPermissionMessage = message.id.startsWith("perm-");
    if (task && permission) {
      // The agent is blocked on an approval — highest-priority "needs you".
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
    } else if (done && !working && task && !isPermissionMessage) {
      // The turn completed with no pending approval — the agent finished and
      // handed control back. Surface it as a finished attention carrying its
      // closing line so the board card, sidebar, and notification reflect
      // "done this turn, waiting on you" instead of silently dropping to idle.
      const finishedLine = chatActivityLine(message);
      outcome.finished = true;
      outcome.finishedLine = finishedLine;
      store.setTaskAttention((current) =>
        upsertTaskAttention(current, {
          taskId,
          kind: "idle",
          title: task.title,
          agentName: task.agentName,
          message: finishedLine,
          updatedAt: message.createdAt,
        }),
      );
    } else if (working && task) {
      // The agent is streaming again — drop a stale *finished* attention so the
      // live activity line shows. A pending permission's `needs_input` is left
      // alone (it settles at turn end or on session exit), and this is a no-op
      // when there's nothing to clear, to avoid re-renders on every chunk.
      store.setTaskAttention((current) =>
        current.some((item) => item.taskId === taskId && item.kind === "idle")
          ? clearTaskAttention(current, taskId)
          : current,
      );
    }
  }

  return outcome;
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
