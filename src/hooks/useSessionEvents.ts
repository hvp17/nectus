import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { isTauriRuntime, notifySessionEvent } from "../sessionNotifications";
import { clearTaskAttention, upsertTaskAttention, type TaskAttention } from "../sessionAttention";
import { taskFinishedToast, taskNeedsInputToast, type TaskToast } from "../taskNotification";
import type {
  SessionActivityEvent,
  SessionExitedEvent,
  SessionIdleEvent,
  SessionNeedsInputEvent,
  TaskSummary,
} from "../types";

interface UseSessionEventsParams {
  tasksRef: RefObject<TaskSummary[]>;
  setTasks: Dispatch<SetStateAction<TaskSummary[]>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setTaskToast: Dispatch<SetStateAction<TaskToast | null>>;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
  setLiveLines: Dispatch<SetStateAction<Record<number, string>>>;
}

export function useSessionEvents({
  tasksRef,
  setTasks,
  setMessage,
  setTaskToast,
  setTaskAttention,
  setLiveLines,
}: UseSessionEventsParams) {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlistenCallbacks: UnlistenFn[] = [];
    let disposed = false;

    const addListener = async <T,>(eventName: string, handler: Parameters<typeof listen<T>>[1]) => {
      const unlisten = await listen<T>(eventName, handler);
      if (disposed) {
        unlisten();
      } else {
        unlistenCallbacks.push(unlisten);
      }
    };

    const register = async () => {
      await addListener<SessionIdleEvent>("session_idle", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const agentName = task?.agentName ?? "Codex";
        const taskTitle = task?.title ?? "task is waiting";
        const detail = event.payload.message ? ` ${event.payload.message}` : "";
        if (task) {
          setTaskAttention((current) => upsertTaskAttention(current, task, event.payload));
          // Clickable toast that focuses this task's workspace.
          setTaskToast(taskFinishedToast(task, event.payload));
        } else {
          setMessage(`${agentName} finished: ${taskTitle}${detail}`);
        }
        void notifySessionEvent(`${agentName} finished`, `${taskTitle}${detail}`);
      });
      await addListener<SessionNeedsInputEvent>("session_needs_input", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const agentName = task?.agentName ?? "Codex";
        const taskTitle = task?.title ?? "a task";
        const prompt = event.payload.prompt ? `: ${event.payload.prompt}` : "";
        const reason = event.payload.reason ? ` (${event.payload.reason})` : "";
        if (task) {
          setTaskAttention((current) => upsertTaskAttention(current, task, event.payload));
          // Clickable toast that focuses this task's workspace.
          setTaskToast(taskNeedsInputToast(task, event.payload));
        } else {
          setMessage(`${agentName} needs input for ${taskTitle}${reason}${prompt}`);
        }
        void notifySessionEvent(`${agentName} needs input`, `${taskTitle}${reason}${prompt}`);
      });
      await addListener<SessionActivityEvent>("session_activity", (event) => {
        setLiveLines((current) => ({ ...current, [event.payload.taskId]: event.payload.line }));
      });
      await addListener<SessionExitedEvent>("session_exited", (event) => {
        const exited = tasksRef.current.find((task) => task.activeSessionId === event.payload.sessionId);
        setTasks((current) =>
          current.map((task) =>
            task.activeSessionId === event.payload.sessionId ? { ...task, activeSessionId: null } : task,
          ),
        );
        if (exited) {
          setLiveLines((current) => {
            if (!(exited.id in current)) return current;
            const next = { ...current };
            delete next[exited.id];
            return next;
          });
          // A background task's agent can exit while in needs_input/idle; the
          // per-TerminalPane clear only covers the *selected* task, so the global
          // listener owns clearing attention to avoid phantom Mission Control
          // groups and a stale needs-input badge.
          setTaskAttention((current) => clearTaskAttention(current, exited.id));
        }
      });
    };

    register().catch((error) => {
      if (!disposed) setMessage(String(error));
    });

    return () => {
      disposed = true;
      unlistenCallbacks.forEach((unlisten) => unlisten());
    };
  }, [setLiveLines, setMessage, setTaskToast, setTaskAttention, setTasks, tasksRef]);
}
