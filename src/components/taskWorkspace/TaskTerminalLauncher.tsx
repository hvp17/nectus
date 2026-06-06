import { Play, RotateCcw, TerminalSquare } from "lucide-react";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import type { TaskSummary } from "../../types";

/// Empty-stage state shown when a task has no active session: resume a saved
/// session (Codex/Claude) or start/restart the agent. Mirrors the Review pane's
/// `Empty` treatment so the no-session stage reads as sleek as the rest of the app.
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
  const hasSavedSession = Boolean(task.lastSessionId);
  const canResume = hasSavedSession && canResumeSession;

  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TerminalSquare />
        </EmptyMedia>
        <EmptyTitle>{hasSavedSession ? "No active session" : "Ready when you are"}</EmptyTitle>
        <EmptyDescription>
          {hasSavedSession
            ? "Pick up where the agent left off, or restart it from a clean slate."
            : "Launch the agent to start working on this task."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {canResume && (
            <Button type="button" variant="outline" aria-label="Resume session" onClick={() => onResumeSession(task)}>
              <RotateCcw data-icon="inline-start" />
              Resume
            </Button>
          )}
          <Button
            type="button"
            aria-label={hasSavedSession ? "Restart agent" : "Start agent"}
            onClick={() => onStartSession(task)}
          >
            <Play data-icon="inline-start" fill="currentColor" />
            {hasSavedSession ? "Restart" : "Start"}
          </Button>
        </div>
        {task.lastSessionLabel && (
          <p className="max-w-[48ch] truncate font-mono text-xs text-muted-foreground">{task.lastSessionLabel}</p>
        )}
      </EmptyContent>
    </Empty>
  );
}
