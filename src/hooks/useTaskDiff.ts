import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queries/keys";
import { useOptionalQuery } from "../queries/optional";
import type { TaskDiffSummary } from "../types";

/** Lazy-loaded patch state for a single file in the diff. */
export interface FileDiffState {
  patch?: string;
  loading: boolean;
  error?: string | null;
}

export interface TaskDiff {
  summary: TaskDiffSummary | null;
  loading: boolean;
  error: string | null;
  /** Per-file patch cache, keyed by file path; populated on demand by `loadFile`. */
  files: Record<string, FileDiffState>;
  refresh: () => Promise<void>;
  loadFile: (file: string) => Promise<void>;
}

/**
 * Owns the task diff data: the changed-file summary is a TanStack Query keyed on
 * the task id, so selecting a task loads it (populating the stage-header badge) and
 * switching tasks shows `null` immediately — the new key has no data yet — without
 * any manual reset. Per-file patches are lazy-loaded on demand into a local map
 * (cleared whenever the task changes or the user refreshes the summary).
 */
export function useTaskDiff(taskId: number | undefined, repoId?: number): TaskDiff {
  const queryClient = useQueryClient();
  const hasTask = taskId != null;

  const summaryQuery = useOptionalQuery<TaskDiffSummary>(
    taskId == null
      ? null
      : {
          queryKey: queryKeys.task.diffSummary(taskId, repoId),
          queryFn: () => api.taskDiffSummary(taskId, repoId),
          staleTime: 0,
        },
  );
  const summary = hasTask ? (summaryQuery.data ?? null) : null;
  const loading = hasTask && summaryQuery.isLoading;
  const error = hasTask && summaryQuery?.error ? String(summaryQuery.error) : null;

  const [files, setFiles] = useState<Record<string, FileDiffState>>({});

  // Drop cached per-file patches when the task changes (a different task's patches
  // are meaningless). A `refresh()` also clears them since they go stale with the
  // summary — but the initial query settle does NOT, so a patch loaded right after
  // selection isn't wiped by the summary arriving a tick later.
  useEffect(() => {
    setFiles({});
  }, [taskId, repoId]);

  const loadFile = useCallback(
    async (file: string) => {
      if (taskId == null) return;
      setFiles((current) => ({ ...current, [file]: { ...current[file], loading: true } }));
      try {
        const patch = await api.taskDiffFile(taskId, file, repoId);
        setFiles((current) => ({ ...current, [file]: { patch, loading: false, error: null } }));
      } catch (err) {
        setFiles((current) => ({ ...current, [file]: { loading: false, error: String(err) } }));
      }
    },
    [taskId, repoId],
  );

  const refresh = useCallback(async () => {
    if (taskId == null) return;
    setFiles({}); // cached patches go stale once the summary is refetched
    await queryClient.invalidateQueries({ queryKey: queryKeys.task.diffSummary(taskId, repoId) });
  }, [queryClient, taskId, repoId]);

  return { summary, loading, error, files, refresh, loadFile };
}
