import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { api } from "../api";
import { clearTaskAttention, type TaskAttention } from "../sessionAttention";
import type { TaskSummary } from "../types";

interface UseTaskDeletionArgs {
  deletingTaskIdsRef: MutableRefObject<Set<number>>;
  setTaskDeleting: (taskId: number, deleting: boolean) => void;
  setTasks: Dispatch<SetStateAction<TaskSummary[]>>;
  setSelectedTaskId: Dispatch<SetStateAction<number | undefined>>;
  setTaskAttention: Dispatch<SetStateAction<TaskAttention[]>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
}

export function useTaskDeletion({
  deletingTaskIdsRef,
  setTaskDeleting,
  setTasks,
  setSelectedTaskId,
  setTaskAttention,
  setMessage,
}: UseTaskDeletionArgs) {
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
      if (deletingTaskIdsRef.current.has(task.id)) {
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
    [
      deletingTaskIdsRef,
      setMessage,
      setSelectedTaskId,
      setTaskAttention,
      setTaskDeleting,
      setTasks,
    ],
  );
}
