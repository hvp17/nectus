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
  const {
    startSession: startCommand,
    resumeSession: resumeCommand,
    stopSession: stopCommand,
    onSessionExit: onSessionExitCommand,
  } = sessionCommands;

  const startSession = useCallback(
    async (task: TaskSummary) => {
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      await startCommand(task);
    },
    [setTaskAttention, startCommand],
  );

  const resumeSession = useCallback(
    async (task: TaskSummary) => {
      setTaskAttention((current) => clearTaskAttention(current, task.id));
      await resumeCommand(task);
    },
    [setTaskAttention, resumeCommand],
  );

  const stopSession = useCallback(
    async (sessionId: string) => {
      const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
      if (task) {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
      await stopCommand(sessionId);
    },
    [setTaskAttention, stopCommand, tasksRef],
  );

  const onSessionExit = useCallback(
    (sessionId: string) => {
      const task = tasksRef.current.find((task) => task.activeSessionId === sessionId);
      if (task) {
        setTaskAttention((current) => clearTaskAttention(current, task.id));
      }
      onSessionExitCommand(sessionId);
    },
    [onSessionExitCommand, setTaskAttention, tasksRef],
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
