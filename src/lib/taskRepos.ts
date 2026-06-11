import type { TaskSummary } from "../types";

/**
 * Helpers for scoping a cross-repo task to one of its member repos. The primary
 * repo's state lives on the task row itself (`prUrl`, `worktreePath`); a
 * non-primary member's state lives on its `taskRepos` entry. `repoId` of
 * `undefined` (or the primary repo's id) means the primary repo everywhere.
 */

/** Whether the task spans more than one repo (Increment B cross-repo task). */
export function isCrossRepoTask(task: TaskSummary | undefined): boolean {
  return (task?.taskRepos.length ?? 0) > 1;
}

/** The PR URL linked for one of a task's member repos. */
export function taskRepoPrUrl(task: TaskSummary | undefined, repoId?: number): string | null {
  if (!task) return null;
  if (repoId == null || repoId === task.repoId) return task.prUrl ?? null;
  return task.taskRepos.find((taskRepo) => taskRepo.repoId === repoId)?.prUrl ?? null;
}

/** The worktree path for one of a task's member repos. */
export function taskRepoWorktreePath(task: TaskSummary | undefined, repoId?: number): string | null {
  if (!task) return null;
  if (repoId == null || repoId === task.repoId) return task.worktreePath ?? null;
  return task.taskRepos.find((taskRepo) => taskRepo.repoId === repoId)?.worktreePath ?? null;
}

/** The display name for one of a task's member repos. */
export function taskRepoName(task: TaskSummary | undefined, repoId?: number): string | null {
  if (!task) return null;
  const target = repoId ?? task.repoId;
  return task.taskRepos.find((taskRepo) => taskRepo.repoId === target)?.repoName ?? null;
}
