import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { useGuardedAction } from "./useGuardedAction";
import { useAppStore } from "../store/appStore";
import { clearTaskAttention } from "../sessionAttention";
import { replaceById } from "../lib/listState";
import type { TaskStatus, TaskSummary } from "../types";

/**
 * The whole-task metadata actions that apply to ANY task (status / title / JIRA
 * link) — distinct from the open-task PR/review actions which live in
 * `TaskWorkspace`. Self-sufficient: reads the store + writes the task cache
 * directly, so the board views and the task workspace can call it without props.
 */
export function useTaskActions() {
  const queryClient = useQueryClient();
  const setMessage = useAppStore((s) => s.setMessage);
  const setBusy = useAppStore((s) => s.setBusy);
  const setTaskAttention = useAppStore((s) => s.setTaskAttention);
  const run = useGuardedAction(setMessage, setBusy);
  const setTasks = useMemo(
    () => makeCacheSetter<TaskSummary[]>(queryClient, queryKeys.tasks()),
    [queryClient],
  );

  const updateStatus = useCallback(
    (task: TaskSummary, status: TaskStatus) =>
      run(async () => {
        const updated = await api.updateTaskMetadata({ taskId: task.id, status });
        setTasks((current) => replaceById(current, updated));
        if (status === "done") {
          setTaskAttention((current) => clearTaskAttention(current, task.id));
        }
      }),
    [run, setTasks, setTaskAttention],
  );

  const renameTask = useCallback(
    (task: TaskSummary, title: string) => {
      const trimmed = title.trim();
      if (!trimmed || trimmed === task.title) return;
      void run(async () => {
        const updated = await api.updateTaskMetadata({ taskId: task.id, title: trimmed });
        setTasks((current) => replaceById(current, updated));
      });
    },
    [run, setTasks],
  );

  const setTaskJiraLink = useCallback(
    (taskId: number, link: { key: string; summary: string; url: string | null } | null) =>
      run(async () => {
        const updated = await api.setTaskJiraLink({
          taskId,
          key: link?.key ?? null,
          summary: link?.summary ?? null,
          url: link?.url ?? null,
        });
        setTasks((current) => replaceById(current, updated));
      }),
    [run, setTasks],
  );

  return { updateStatus, renameTask, setTaskJiraLink };
}
