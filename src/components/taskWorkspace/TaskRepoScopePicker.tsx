import { FolderGit2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { isCrossRepoTask } from "../../lib/taskRepos";
import type { TaskSummary } from "../../types";

interface TaskRepoScopePickerProps {
  task: TaskSummary;
  /** The scoped member repo (undefined → the primary repo). */
  activeRepoId?: number;
  onSelectRepo: (repoId: number | undefined) => void;
}

/**
 * Compact member-repo switcher for a cross-repo task: scopes the Diff tab and the
 * GitHub panel to one of the task's repos. Renders nothing for single-repo tasks,
 * so callers can mount it unconditionally.
 */
export function TaskRepoScopePicker({ task, activeRepoId, onSelectRepo }: TaskRepoScopePickerProps) {
  if (!isCrossRepoTask(task)) return null;
  const selected = activeRepoId ?? task.repoId;
  return (
    <Select
      value={String(selected)}
      onValueChange={(value) => {
        const repoId = Number(value);
        onSelectRepo(repoId === task.repoId ? undefined : repoId);
      }}
    >
      <SelectTrigger size="sm" aria-label="Scope to repository">
        <FolderGit2 size={12} aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {task.taskRepos.map((taskRepo) => (
          <SelectItem key={taskRepo.repoId} value={String(taskRepo.repoId)}>
            {taskRepo.repoName}
            {taskRepo.repoId === task.repoId ? " (primary)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
