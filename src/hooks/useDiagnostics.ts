import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useTauriEvent } from "./useTauriEvent";

/** Keep the panel bounded; mirrors the backend ring buffer cap. */
const MAX_LINES = 4000;

/**
 * Backs the Settings → Diagnostics panel: backfills the buffered Rust log lines
 * on mount, then appends each live `diagnostic_log` line the backend streams. The
 * backend buffer is independent of the DB lock, so this keeps updating even while
 * a DB-bound command is stuck — which is exactly when we need to read the log.
 */
export function useDiagnostics() {
  const [lines, setLines] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const fresh = await api.getDiagnosticLogs();
    setLines(fresh.slice(-MAX_LINES));
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getDiagnosticLogs()
      .then((initial) => {
        if (!cancelled) setLines(initial.slice(-MAX_LINES));
      })
      .catch(() => {
        /* best-effort backfill: live events still populate the panel */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent<string>("diagnostic_log", (line) => {
    setLines((current) => {
      const next = current.length >= MAX_LINES ? current.slice(current.length - MAX_LINES + 1) : current.slice();
      next.push(line);
      return next;
    });
  });

  const clear = useCallback(() => setLines([]), []);

  return { lines, refresh, clear };
}
