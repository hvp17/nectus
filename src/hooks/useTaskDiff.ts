import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { isTauriRuntime } from "../sessionNotifications";
import type { SessionIdleEvent, TaskDiffSummary } from "../types";

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
 * Owns the task diff data: loads the changed-file summary as soon as a task is
 * selected (so the stage-header badge — file count and ±line totals — is populated
 * without opening the Diff tab first), lazy-loads per-file patches, and re-fetches
 * the summary when the task's agent finishes a turn (`session_idle`) so the diff
 * stays current while the agent works. Loading on selection plus refreshing on each
 * turn boundary keeps the badge live without any timer-based polling. The summary is
 * reset when the task changes so a stale diff never lingers across tasks.
 */
export function useTaskDiff(taskId: number | undefined): TaskDiff {
  const [summary, setSummary] = useState<TaskDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, FileDiffState>>({});

  const refresh = useCallback(async () => {
    if (taskId == null) return;
    setLoading(true);
    setError(null);
    try {
      const next = await api.taskDiffSummary(taskId);
      setSummary(next);
      setFiles({}); // cached patches may be stale once the summary changes
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const loadFile = useCallback(
    async (file: string) => {
      if (taskId == null) return;
      setFiles((current) => ({ ...current, [file]: { ...current[file], loading: true } }));
      try {
        const patch = await api.taskDiffFile(taskId, file);
        setFiles((current) => ({ ...current, [file]: { patch, loading: false, error: null } }));
      } catch (err) {
        setFiles((current) => ({ ...current, [file]: { loading: false, error: String(err) } }));
      }
    },
    [taskId],
  );

  // Clear stale state when switching tasks, then load the new task's summary so the
  // badge appears immediately without the user opening the Diff tab first.
  useEffect(() => {
    setSummary(null);
    setFiles({});
    setError(null);
    if (taskId == null) return;
    void refresh();
  }, [taskId, refresh]);

  // A finished turn likely changed the diff; refresh to keep the badge current while
  // the agent works, whether or not the Diff tab has been opened.
  useEffect(() => {
    if (!isTauriRuntime() || taskId == null) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<SessionIdleEvent>("session_idle", (event) => {
      if (event.payload.taskId === taskId) void refresh();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [taskId, refresh]);

  return { summary, loading, error, files, refresh, loadFile };
}
