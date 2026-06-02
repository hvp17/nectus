import { useCallback, type Dispatch, type SetStateAction } from "react";
import { api } from "../api";
import { useGuardedAction } from "./useGuardedAction";
import type { AgentProfile, Session, TaskSummary } from "../types";

interface UseSessionCommandsParams {
  agentProfiles: AgentProfile[];
  selectedAgentProfileId?: number;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setSelectedTaskId: Dispatch<SetStateAction<number | undefined>>;
  setTasks: Dispatch<SetStateAction<TaskSummary[]>>;
}

export function useSessionCommands({
  agentProfiles,
  selectedAgentProfileId,
  setMessage,
  setSelectedTaskId,
  setTasks,
}: UseSessionCommandsParams) {
  const run = useGuardedAction(setMessage);

  const applySession = useCallback(
    (session: Session) => {
      setTasks((current) =>
        current.map((task) => {
          if (task.id !== session.taskId) return task;
          return {
            ...task,
            activeSessionId: session.state === "running" ? session.id : null,
            lastSessionId: session.resumableSessionId ?? session.id,
            lastSessionLabel: session.resumableSessionLabel ?? task.lastSessionLabel,
          };
        }),
      );
    },
    [setTasks],
  );

  const startSession = async (task: TaskSummary) => {
    const agentProfileId = task.agentProfileId ?? selectedAgentProfileId ?? agentProfiles[0]?.id;
    if (!agentProfileId) return;
    await run(async () => {
      const session = await api.startSession(task.id, agentProfileId);
      applySession(session);
      setSelectedTaskId(task.id);
    });
  };

  const stopSession = (sessionId: string) =>
    run(async () => {
      const session = await api.stopSession(sessionId);
      applySession(session);
    });

  const resumeSession = (task: TaskSummary) =>
    run(async () => {
      const session = await api.resumeSession(task.id);
      applySession(session);
      setSelectedTaskId(task.id);
    });

  const onSessionExit = useCallback(
    (sessionId: string) => {
      setTasks((current) =>
        current.map((task) => (task.activeSessionId === sessionId ? { ...task, activeSessionId: null } : task)),
      );
    },
    [setTasks],
  );

  return {
    startSession,
    stopSession,
    resumeSession,
    onSessionExit,
  };
}
