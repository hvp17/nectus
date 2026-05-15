import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { isTauri, notifySessionEvent } from "../sessionNotifications";
import type { SessionExitedEvent, SessionIdleEvent, SessionNeedsInputEvent, TaskSummary } from "../types";

interface UseSessionEventsParams {
  tasksRef: RefObject<TaskSummary[]>;
  setTasks: Dispatch<SetStateAction<TaskSummary[]>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export function useSessionEvents({ tasksRef, setTasks, setMessage }: UseSessionEventsParams) {
  useEffect(() => {
    if (!isTauri) return;

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
        const msg = `${agentName} finished: ${taskTitle}${detail}`;
        setMessage(msg);
        void notifySessionEvent(`${agentName} finished`, `${taskTitle}${detail}`);
      });
      await addListener<SessionNeedsInputEvent>("session_needs_input", (event) => {
        const task = tasksRef.current.find((task) => task.id === event.payload.taskId);
        const agentName = task?.agentName ?? "Codex";
        const taskTitle = task?.title ?? "a task";
        const prompt = event.payload.prompt ? `: ${event.payload.prompt}` : "";
        const reason = event.payload.reason ? ` (${event.payload.reason})` : "";
        const msg = `${agentName} needs input for ${taskTitle}${reason}${prompt}`;
        setMessage(msg);
        void notifySessionEvent(`${agentName} needs input`, `${taskTitle}${reason}${prompt}`);
      });
      await addListener<SessionExitedEvent>("session_exited", (event) => {
        setTasks((current) =>
          current.map((task) =>
            task.activeSessionId === event.payload.sessionId ? { ...task, activeSessionId: null } : task,
          ),
        );
      });
    };

    register().catch((error) => {
      if (!disposed) setMessage(String(error));
    });

    return () => {
      disposed = true;
      unlistenCallbacks.forEach((unlisten) => unlisten());
    };
  }, [setMessage, setTasks, tasksRef]);
}
