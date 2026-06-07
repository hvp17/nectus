import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAgentProfilesQuery, useTasksQuery } from "../queries/core";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { useAppStore } from "../store/appStore";
import { useSessionCommands } from "./useSessionCommands";
import { useSessionAttentionControls } from "./useSessionAttentionControls";
import type { AgentProfile, TaskSummary } from "../types";

const EMPTY_PROFILES: AgentProfile[] = [];
const EMPTY_TASKS: TaskSummary[] = [];

/**
 * Session start/resume/stop + the attention-clearing wrappers, composed
 * self-sufficiently from the store and the task cache. Returns
 * `{ startSession, resumeSession, stopSession, onSessionExit, onSessionInput }`.
 */
export function useSessionControls() {
  const queryClient = useQueryClient();
  const agentProfiles = useAgentProfilesQuery().data ?? EMPTY_PROFILES;
  const tasks = useTasksQuery().data ?? EMPTY_TASKS;
  const selectedAgentProfileId = useAppStore((s) => s.selectedAgentProfileId);
  const setMessage = useAppStore((s) => s.setMessage);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const setTaskAttention = useAppStore((s) => s.setTaskAttention);
  const setTasks = useMemo(
    () => makeCacheSetter<TaskSummary[]>(queryClient, queryKeys.tasks()),
    [queryClient],
  );

  const tasksRef = useRef<TaskSummary[]>(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const sessionCommands = useSessionCommands({
    agentProfiles,
    selectedAgentProfileId,
    setMessage,
    setSelectedTaskId,
    setTasks,
  });

  return useSessionAttentionControls({ tasksRef, setTaskAttention, sessionCommands });
}
