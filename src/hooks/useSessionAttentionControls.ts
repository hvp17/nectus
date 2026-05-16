import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { clearTaskAttention, type TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";

interface SessionCommandHandlers {
  startSession: (task: TaskSummary) => Promise<void>;
  resumeSession: (task: TaskSummary) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  onSessionExit: (sessionId: string) => void;
}

interface UseSessionAttentionControlsArgs {
  tasksRef: MutableRefObject<TaskSummary[]>;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
  sessionCommands: SessionCommandHandlers;
}

export function useSessionAttentionControls({
  tasksRef,
  setTaskAttention,
  sessionCommands,
}: UseSessionAttentionControlsArgs) {
  const startSession = async (task: TaskSummary) => {
    setTaskAttention((current) => clearTaskAttention(current, task.id));
    await sessionCommands.startSession(task);
  };

  const resumeSession = async (task: TaskSummary) => {
    setTaskAttention((current) => clearTaskAttention(current, task.id));
    await sessionCommands.resumeSession(task);
  };

  const stopSession = async (sessionId: string) => {
    const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
    if (task) {
      setTaskAttention((current) => clearTaskAttention(current, task.id));
    }
    await sessionCommands.stopSession(sessionId);
  };

  const onSessionExit = useCallback(
    (sessionId: string) => {
      const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
      if (task) {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
      sessionCommands.onSessionExit(sessionId);
    },
    [sessionCommands, setTaskAttention, tasksRef],
  );

  const onSessionInput = useCallback(
    (sessionId: string) => {
      const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
      if (task) {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
    },
    [setTaskAttention, tasksRef],
  );

  return {
    startSession,
    resumeSession,
    stopSession,
    onSessionExit,
    onSessionInput,
  };
}
