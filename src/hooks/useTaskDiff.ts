import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * Owns the task diff data: loads the changed-file summary, lazy-loads per-file
 * patches, and re-fetches the summary when the task's agent finishes a turn
 * (`session_idle`) so the diff stays current while the agent works. The summary is
 * reset when the task changes so a stale diff never lingers across tasks.
 */
export function useTaskDiff(taskId: number | undefined): TaskDiff {
  const [summary, setSummary] = useState<TaskDiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, FileDiffState>>({});

  // Mirror the summary in a ref so the idle listener can decide whether the diff
  // has been opened (and is worth refreshing) without re-subscribing on every load.
  const summaryRef = useRef<TaskDiffSummary | null>(null);
  useEffect(() => {
    summaryRef.current = summary;
  }, [summary]);

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

  // Clear state when switching tasks so the next task starts from a clean slate.
  useEffect(() => {
    setSummary(null);
    setFiles({});
    setError(null);
  }, [taskId]);

  // A finished turn likely changed the diff; refresh only once it has been opened.
  useEffect(() => {
    if (!isTauriRuntime() || taskId == null) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    void listen<SessionIdleEvent>("session_idle", (event) => {
      if (event.payload.taskId === taskId && summaryRef.current) void refresh();
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
