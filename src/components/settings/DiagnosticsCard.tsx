import { useEffect, useRef } from "react";
import { ClipboardCopy, RefreshCw, Trash2 } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useDiagnostics } from "../../hooks/useDiagnostics";

/**
 * Live view of the backend `tracing` log (the same lines the Rust side prints to
 * the console). Backfilled on open and streamed thereafter, so it keeps updating
 * even while a command is stuck holding the DB lock — use it to see exactly where
 * the app hangs (e.g. a `create_worktree` step with no following "done" line).
 */
export function DiagnosticsCard() {
  const { lines, refresh, clear } = useDiagnostics();
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  // Auto-follow the tail, but only while the user is already at the bottom — so
  // scrolling up to read history isn't yanked back down by incoming lines.
  useEffect(() => {
    const el = viewportRef.current;
    if (el && pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const copyAll = () => {
    void navigator.clipboard?.writeText(lines.join("\n"));
  };

  const lineCountLabel = `${lines.length} ${lines.length === 1 ? "line" : "lines"}`;

  return (
    <div className="nx-diag">
      <div className="nx-diag-bar">
        <Badge variant="outline" aria-label={`${lineCountLabel} captured`}>
          {lineCountLabel}
        </Badge>
        <span className="nx-diag-bar-actions">
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => void refresh()}>
            <RefreshCw data-icon="inline-start" />
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={copyAll}
            disabled={lines.length === 0}
          >
            <ClipboardCopy data-icon="inline-start" />
            Copy
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={clear}
            disabled={lines.length === 0}
          >
            <Trash2 data-icon="inline-start" />
            Clear
          </Button>
        </span>
      </div>
      <div
        ref={viewportRef}
        className="nx-diag-log"
        onScroll={handleScroll}
        role="log"
        aria-label="Backend diagnostics log"
        aria-live="off"
      >
        {lines.length === 0 ? (
          <p className="nx-diag-empty">No log output captured yet. Trigger an action (e.g. create a task) to see backend activity.</p>
        ) : (
          lines.map((line, index) => (
            <div key={index} className="nx-diag-line">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
