import {
  ArrowLeft,
  Square,
  RotateCcw,
  Play,
  ExternalLink,
  TerminalSquare,
  Maximize2,
  Minimize2,
  AlertTriangle,
  CircleCheckBig,
  GitBranch,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { TerminalPane } from "../TerminalPane";
import { cn } from "../lib/utils";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { TaskSummary, TaskStatus } from "../types";

interface TaskDetailDrawerProps {
  task: TaskSummary | undefined;
  attention?: TaskAttention;
  isExpanded: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
  onStopSession: (sessionId: string) => void;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
  onUpdateStatus: (task: TaskSummary, status: TaskStatus) => void;
  onSessionExit: (sessionId: string) => void;
  onSessionInput: (sessionId: string) => void;
}

const statusOrder: TaskStatus[] = ["planned", "in_progress", "review", "done"];
const statusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

export function TaskDetailDrawer({
  task,
  attention,
  isExpanded,
  onClose,
  onToggleExpanded,
  onStopSession,
  onResumeSession,
  onStartSession,
  onUpdateStatus,
  onSessionExit,
  onSessionInput,
}: TaskDetailDrawerProps) {
  if (!task) return null;
  const canResumeSession = task.agentKind === "codex" || task.agentKind === "claude";
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );

  return (
    <aside
      className="detail-pane flex flex-col animate-in slide-in-from-right duration-300 ease-out"
      aria-label="Task inspector"
      data-expanded={isExpanded ? "true" : "false"}
    >
      <div className="detail-header flex items-start justify-between gap-4 p-6 border-b">
        <div className="min-w-0">
          <Button
            variant="ghost"
            onClick={onClose}
            className="-ml-3 mb-3 h-8 gap-2 px-3 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} />
            Back to dashboard
          </Button>
          <p className="eyebrow">Task Detail</p>
          <h3 className="text-xl font-bold truncate leading-tight">{task.title}</h3>
          <div className="detail-status-row">
            <Badge variant="outline" data-status={task.status}>
              {statusLabels[task.status]}
            </Badge>
            {task.activeSessionId && (
              <Badge variant="outline" className="border-primary/40 text-primary">
                Running
              </Badge>
            )}
            {task.isDirty && (
              <Badge variant="outline" className="text-indigo-500">
                Dirty worktree
              </Badge>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={isExpanded ? "Restore dashboard" : "Expand terminal"}
          title={isExpanded ? "Restore dashboard" : "Expand terminal"}
          onClick={onToggleExpanded}
        >
          {isExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </Button>
      </div>

        <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 px-6 pb-6 border-b">
             <div className="flex gap-2 mb-6">
                {task.activeSessionId ? (
                  <Button variant="destructive" className="w-full gap-2" onClick={() => onStopSession(task.activeSessionId!)}>
                    <Square size={14} fill="currentColor" />
                    Stop Session
                  </Button>
                ) : (
                  <>
                    {task.lastSessionId && canResumeSession && (
                      <Button variant="outline" className="flex-1 gap-2" onClick={() => onResumeSession(task)}>
                        <RotateCcw size={14} />
                        Resume
                      </Button>
                    )}
                    <Button className="flex-1 gap-2" onClick={() => onStartSession(task)}>
                      <Play size={14} fill="currentColor" />
                      {task.lastSessionId ? "Restart" : "Start Agent"}
                    </Button>
                  </>
                )}
             </div>

             {attention && (
               <Alert
                 className={cn(
                   "mb-6 border-primary/25 bg-primary/5 px-3 py-3",
                   attention.kind === "needs_input" && "border-amber-500/35 bg-amber-500/10",
                 )}
               >
                 {attention.kind === "needs_input" ? <AlertTriangle size={16} /> : <CircleCheckBig size={16} />}
                 <AlertTitle className="font-bold">
                   {attention.kind === "needs_input" ? formatAttentionReason(attention.reason) : "Agent finished"}
                 </AlertTitle>
                 {attentionDetail && (
                   <AlertDescription
                     className="[overflow-wrap:anywhere]"
                     title={isAttentionDetailTruncated ? attentionDetail : undefined}
                   >
                     {displayedAttentionDetail}
                   </AlertDescription>
                 )}
               </Alert>
             )}

             <dl className="grid grid-cols-[80px_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground font-semibold">Mode</dt>
                <dd className="font-medium">{task.hasWorktree ? "With worktree" : "Task only"}</dd>
                
                {task.hasWorktree && (
                  <>
                    <dt className="text-muted-foreground font-semibold">Branch</dt>
                    <dd className="font-mono text-xs font-medium inline-flex items-center gap-1.5 min-w-0">
                      <GitBranch size={12} />
                      <span className="truncate">{task.branchName}</span>
                    </dd>
                  </>
                )}
                
                <dt className="text-muted-foreground font-semibold">Status</dt>
                <dd>
                  <Select value={task.status} onValueChange={(val) => onUpdateStatus(task, val as TaskStatus)}>
                    <SelectTrigger className="h-8 w-fit text-xs font-medium border-none bg-accent/50 hover:bg-accent focus:ring-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOrder.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">{statusLabels[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </dd>

                <dt className="text-muted-foreground font-semibold">PR</dt>
                <dd>
                  {task.prUrl ? (
                    <a href={task.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold hover:underline">
                      Open PR <ExternalLink size={12} />
                    </a>
                  ) : <span className="opacity-40 italic">Not linked</span>}
                </dd>

                <dt className="text-muted-foreground font-semibold">Agent</dt>
                <dd className="truncate opacity-80">{task.lastSessionAgent ?? task.agentName ?? "None"}</dd>

                {task.prompt && (
                  <>
                    <dt className="text-muted-foreground font-semibold">Brief</dt>
                    <dd className="task-brief">{task.prompt}</dd>
                  </>
                )}
             </dl>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
             <div className="flex shrink-0 items-center gap-2 px-6 py-4 border-b text-[11px] font-bold uppercase tracking-widest opacity-60">
                <TerminalSquare size={14} />
                Agent Terminal
             </div>
             <div className="flex-1 min-h-0 bg-[#0A0A0A]">
                <TerminalPane
                  sessionId={task.activeSessionId}
                  onSessionExit={onSessionExit}
                  onSessionInput={onSessionInput}
                />
             </div>
          </div>
        </div>
      </aside>
    );
  }
