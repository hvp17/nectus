import { Play, RotateCcw, TerminalSquare } from "lucide-react";
import { Button } from "../ui/button";
import type { TaskSummary } from "../../types";

/// Empty-stage state shown when a task has no active session: resume a saved
/// session (Codex/Claude) or start/restart the agent.
export function TaskTerminalLauncher({
  task,
  canResumeSession,
  onResumeSession,
  onStartSession,
}: {
  task: TaskSummary;
  canResumeSession: boolean;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
}) {
  const canResume = Boolean(task.lastSessionId && canResumeSession);

  return (
    <div className="terminal-launcher">
      <div className="terminal-launcher-copy">
        <div className="terminal-launcher-kicker">
          <TerminalSquare size={15} />
          <span>{task.lastSessionId ? "Session saved" : "Ready"}</span>
        </div>
        <p className="terminal-launcher-title">No active session</p>
        {task.lastSessionLabel && <p className="terminal-launcher-detail">{task.lastSessionLabel}</p>}
      </div>
      <div className="terminal-launcher-actions">
        {canResume && (
          <Button type="button" variant="outline" aria-label="Resume session" onClick={() => onResumeSession(task)}>
            <RotateCcw data-icon="inline-start" />
            Resume
          </Button>
        )}
        <Button
          type="button"
          aria-label={task.lastSessionId ? "Restart agent" : "Start agent"}
          onClick={() => onStartSession(task)}
        >
          <Play data-icon="inline-start" fill="currentColor" />
          {task.lastSessionId ? "Restart" : "Start"}
        </Button>
      </div>
    </div>
  );
}
