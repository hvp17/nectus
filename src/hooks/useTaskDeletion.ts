import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { makeCacheSetter } from "../queries/cache";
import { useAppStore } from "../store/appStore";
import { clearTaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";

/**
 * Returns a `requestDeleteTask(task)` action that reads/writes the store and the
 * task cache directly, so any component can call it without drilled setters. The
 * in-progress set (`deletingTaskIds`) lives in the store, keeping concurrent
 * deletes consistent across every consumer.
 */
export function useTaskDeletion() {
  const queryClient = useQueryClient();
  const setTasks = useMemo(
    () => makeCacheSetter<TaskSummary[]>(queryClient, queryKeys.tasks()),
    [queryClient],
  );
  const setTaskDeleting = useAppStore((s) => s.setTaskDeleting);
  const setSelectedTaskId = useAppStore((s) => s.setSelectedTaskId);
  const setTaskAttention = useAppStore((s) => s.setTaskAttention);
  const setMessage = useAppStore((s) => s.setMessage);

  return useCallback(
    (task: TaskSummary) => {
      setMessage(null);
      if (task.activeSessionId) {
        toast.error("Delete blocked", {
          description: "Stop the running session before deleting this task.",
          duration: 5000,
        });
        return;
      }
      if (useAppStore.getState().deletingTaskIds.has(task.id)) {
        return;
      }

      setTaskDeleting(task.id, true);
      const toastId = toast.loading(`Deleting ${task.title}`, {
        description: task.hasWorktree
          ? "Removing task and worktree in the background."
          : "Removing task in the background.",
        duration: Infinity,
      });

      const runDelete = async () => {
        try {
          // The delete dialog warns when the worktree is dirty, so a confirmed
          // deletion of a dirty worktree-backed task force-discards its changes;
          // otherwise the backend removes only a clean worktree.
          await api.deleteTask(task.id, Boolean(task.hasWorktree && task.isDirty));
          setTasks((current) => current.filter((item) => item.id !== task.id));
          setSelectedTaskId((current) => (current === task.id ? undefined : current));
          setTaskAttention((current) => clearTaskAttention(current, task.id));
          toast.success(`Deleted ${task.title}`, {
            id: toastId,
            description: task.hasWorktree ? "Task and worktree removed." : "Task removed.",
            duration: 5000,
          });
        } catch (error) {
          toast.error("Delete failed", {
            id: toastId,
            description: String(error),
            duration: 8000,
          });
        } finally {
          setTaskDeleting(task.id, false);
        }
      };

      void runDelete();
    },
    [setTasks, setSelectedTaskId, setTaskAttention, setMessage, setTaskDeleting],
  );
}
