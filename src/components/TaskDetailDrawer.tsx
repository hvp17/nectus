import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  Check,
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
  LoaderCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "./reui/stepper";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { truncateFinishedAttentionPreview } from "./attentionPreview";
import { TerminalPane } from "../TerminalPane";
import { cn } from "../lib/utils";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { AgentProfile, ReviewLoop, ReviewRun, TaskSummary, TaskStatus } from "../types";

interface TaskDetailDrawerProps {
  task: TaskSummary | undefined;
  attention?: TaskAttention;
  agentProfiles: AgentProfile[];
  reviewLoop?: ReviewLoop | null;
  reviewRuns: ReviewRun[];
  isExpanded: boolean;
  onClose: () => void;
  onToggleExpanded: () => void;
  onStopSession: (sessionId: string) => void;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
  onStartPairLoop: (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => void;
  onStartReview: (task: TaskSummary, reviewerProfileId: number, maxRounds: number) => void;
  onStopPairLoop: (task: TaskSummary) => void;
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
const reviewLoopStatusLabels: Record<ReviewLoop["status"], string> = {
  running: "Running",
  reviewing: "Reviewing",
  passed: "Passed",
  max_rounds_reached: "Max rounds",
  error: "Error",
  stopped: "Stopped",
};
const reviewVerdictLabels: Record<ReviewRun["verdict"], string> = {
  pass: "Pass",
  needs_changes: "Needs changes",
  feedback: "Feedback",
  unknown: "Unknown",
};
const DEFAULT_TERMINAL_HEIGHT = 360;
const MIN_TERMINAL_HEIGHT = 220;
const MIN_DETAIL_HEIGHT = 220;
const MAX_TERMINAL_HEIGHT = 760;
const TERMINAL_RESIZE_STEP = 32;

function getTerminalHeightLimit(frameHeight?: number) {
  if (!frameHeight || !Number.isFinite(frameHeight)) return MAX_TERMINAL_HEIGHT;
  return Math.max(MIN_TERMINAL_HEIGHT, Math.min(MAX_TERMINAL_HEIGHT, frameHeight - MIN_DETAIL_HEIGHT));
}

function clampTerminalHeight(height: number, frameHeight?: number) {
  const maxHeight = getTerminalHeightLimit(frameHeight);
  const normalizedHeight = Number.isFinite(height) ? height : maxHeight;
  return Math.round(Math.min(maxHeight, Math.max(MIN_TERMINAL_HEIGHT, normalizedHeight)));
}

export function TaskDetailDrawer({
  task,
  attention,
  agentProfiles,
  reviewLoop,
  reviewRuns,
  isExpanded,
  onClose,
  onToggleExpanded,
  onStopSession,
  onResumeSession,
  onStartSession,
  onStartPairLoop,
  onStartReview,
  onStopPairLoop,
  onUpdateStatus,
  onSessionExit,
  onSessionInput,
}: TaskDetailDrawerProps) {
  const reviewerProfiles = useMemo(
    () => agentProfiles,
    [agentProfiles],
  );
  const defaultReviewerProfileId =
    reviewerProfiles.find((profile) => profile.id !== task?.agentProfileId)?.id ?? reviewerProfiles[0]?.id;
  const [reviewerProfileId, setReviewerProfileId] = useState<number | undefined>(
    reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId,
  );
  const [maxRounds, setMaxRounds] = useState(reviewLoop?.maxRounds ?? 3);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
  const [terminalHeightLimit, setTerminalHeightLimit] = useState(MAX_TERMINAL_HEIGHT);
  const detailBodyRef = useRef<HTMLDivElement | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setReviewerProfileId(reviewLoop?.reviewerProfileId ?? defaultReviewerProfileId);
    setMaxRounds(reviewLoop?.maxRounds ?? 3);
  }, [defaultReviewerProfileId, reviewLoop?.maxRounds, reviewLoop?.reviewerProfileId]);

  useEffect(() => {
    const detailBody = detailBodyRef.current;
    if (!detailBody || typeof ResizeObserver === "undefined") return undefined;

    const resizeObserver = new ResizeObserver(() => {
      const { height } = detailBody.getBoundingClientRect();
      setTerminalHeightLimit(getTerminalHeightLimit(height));
      setTerminalHeight((current) => clampTerminalHeight(current, height));
    });
    resizeObserver.observe(detailBody);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    [],
  );

  const updateTerminalHeightFromClientY = (clientY: number) => {
    const detailBody = detailBodyRef.current;
    if (!detailBody) return;

    const rect = detailBody.getBoundingClientRect();
    setTerminalHeightLimit(getTerminalHeightLimit(rect.height));
    setTerminalHeight(clampTerminalHeight(rect.bottom - clientY, rect.height));
  };

  const handleTerminalResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button > 0) return;

    event.preventDefault();
    resizeCleanupRef.current?.();
    updateTerminalHeightFromClientY(event.clientY);

    const resizeHandle = event.currentTarget;
    resizeHandle.setPointerCapture?.(event.pointerId);
    document.body.setAttribute("data-resizing-terminal", "true");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      updateTerminalHeightFromClientY(moveEvent.clientY);
    };
    const stopResize = () => {
      resizeHandle.releasePointerCapture?.(event.pointerId);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.removeAttribute("data-resizing-terminal");
      resizeCleanupRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    resizeCleanupRef.current = stopResize;
  };

  const handleTerminalResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const frameHeight = detailBodyRef.current?.getBoundingClientRect().height;
    if (frameHeight) {
      setTerminalHeightLimit(getTerminalHeightLimit(frameHeight));
    }
    setTerminalHeight((current) => {
      if (event.key === "Home") return clampTerminalHeight(MIN_TERMINAL_HEIGHT, frameHeight);
      if (event.key === "End") return clampTerminalHeight(Number.POSITIVE_INFINITY, frameHeight);
      const direction = event.key === "ArrowUp" || event.key === "PageUp" ? 1 : -1;
      const step = event.key === "PageUp" || event.key === "PageDown" ? TERMINAL_RESIZE_STEP * 3 : TERMINAL_RESIZE_STEP;
      return clampTerminalHeight(current + direction * step, frameHeight);
    });
  };

  const latestReviewRun = reviewRuns.at(-1);
  const pairLoopActive = Boolean(reviewLoop && !["passed", "max_rounds_reached", "error", "stopped"].includes(reviewLoop.status));
  const reviewInProgress = reviewLoop?.status === "reviewing";
  if (!task) return null;
  const canResumeSession = task.agentKind === "codex" || task.agentKind === "claude";
  const attentionDetail = attention?.prompt ?? attention?.message;
  const displayedAttentionDetail =
    attention?.kind === "idle" && attentionDetail ? truncateFinishedAttentionPreview(attentionDetail) : attentionDetail;
  const isAttentionDetailTruncated = Boolean(
    attentionDetail && displayedAttentionDetail && displayedAttentionDetail !== attentionDetail,
  );
  const startReviewDisabled = !reviewerProfileId || reviewerProfiles.length === 0 || reviewInProgress;
  const hasReviewResult = Boolean(
    reviewLoop &&
      (reviewLoop.currentRound > 0 || ["passed", "max_rounds_reached", "error", "stopped"].includes(reviewLoop.status)),
  );
  const workflowStep = task.status === "done" || task.prUrl ? 3 : reviewInProgress ? 1 : hasReviewResult ? 2 : 1;
  const startReview = () => {
    if (!reviewerProfileId || startReviewDisabled) return;
    onStartReview(task, reviewerProfileId, Math.min(10, Math.max(1, maxRounds || 3)));
  };
  const workflowSteps = [
    {
      title: reviewInProgress ? "Reviewing..." : "Start review",
      description: reviewInProgress ? "Reviewer is checking the task" : "Run one reviewer pass",
      completed: hasReviewResult || task.status === "done",
      loading: reviewInProgress,
      disabled: startReviewDisabled,
      onClick: startReview,
    },
    {
      title: "Create PR",
      description: task.prUrl ? "Pull request linked" : "Placeholder",
      completed: Boolean(task.prUrl),
      loading: false,
      disabled: true,
      onClick: undefined,
    },
    {
      title: "Move to done",
      description: task.status === "done" ? "Task is complete" : "Mark task complete",
      completed: task.status === "done",
      loading: false,
      disabled: task.status === "done",
      onClick: () => onUpdateStatus(task, "done"),
    },
  ];

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

        <div ref={detailBodyRef} data-testid="task-detail-body" className="detail-body flex flex-1 min-h-0 flex-col overflow-hidden">
          <div className="detail-scroll min-h-0 flex-1 overflow-auto px-6 pb-6">
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

             <section className="task-workflow-panel" aria-label="Task workflow">
               <div>
                 <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Task Workflow</p>
                 <p className="mt-1 text-xs text-muted-foreground">Review, prepare, and close out the task.</p>
               </div>

               <Stepper
                 className="mt-4"
                 value={workflowStep}
                 orientation="vertical"
                 indicators={{
                   completed: <Check className="size-3.5" />,
                   loading: <LoaderCircle className="size-3.5 animate-spin" />,
                 }}
               >
                 <StepperNav className="w-full">
                   {workflowSteps.map((step, index) => (
                     <StepperItem
                       key={step.title}
                       step={index + 1}
                       completed={step.completed}
                       disabled={step.disabled}
                       loading={step.loading}
                       className="relative items-start not-last:flex-1"
                     >
                       <StepperTrigger
                         className={cn(
                           "w-full items-start gap-2.5 text-left disabled:cursor-not-allowed",
                           index < workflowSteps.length - 1 ? "pb-10" : "pb-0",
                         )}
                         onClick={step.onClick}
                       >
                         <StepperIndicator className="data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground">
                           {index + 1}
                         </StepperIndicator>
                         <div className="mt-0.5 min-w-0 text-left">
                           <StepperTitle>{step.title}</StepperTitle>
                           <StepperDescription>{step.description}</StepperDescription>
                         </div>
                       </StepperTrigger>
                       {index < workflowSteps.length - 1 && (
                         <StepperSeparator className="absolute inset-y-0 left-3 top-7 -order-1 m-0 -translate-x-1/2 group-data-[orientation=vertical]/stepper-nav:h-[calc(100%-2rem)] group-data-[state=completed]/step:bg-primary" />
                       )}
                     </StepperItem>
                   ))}
                 </StepperNav>
               </Stepper>
             </section>

             <section className="pair-loop-panel" aria-label="AI pair loop">
               <div className="flex items-center justify-between gap-3">
                 <div>
                   <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">AI Pair Loop</p>
                   <p className="mt-1 text-xs text-muted-foreground">
                     {reviewLoop
                       ? `Round ${reviewLoop.currentRound} of ${reviewLoop.maxRounds}`
                       : "Worker + reviewer"}
                   </p>
                 </div>
                 {reviewLoop && (
                   <Badge variant="outline" className="rounded-md">
                     {reviewLoopStatusLabels[reviewLoop.status]}
                   </Badge>
                 )}
               </div>

               <div className="mt-3 grid grid-cols-[1fr_76px] gap-2">
                 <div className="min-w-0">
                   <Label htmlFor="pair-loop-reviewer" className="sr-only">
                     Reviewer
                   </Label>
                   <Select
                     value={reviewerProfileId?.toString()}
                     onValueChange={(value) => setReviewerProfileId(Number(value))}
                     disabled={pairLoopActive || reviewerProfiles.length === 0}
                   >
                     <SelectTrigger id="pair-loop-reviewer" className="h-8 w-full justify-between text-xs">
                       <SelectValue placeholder="Reviewer" />
                     </SelectTrigger>
                     <SelectContent>
                       {reviewerProfiles.map((profile) => (
                         <SelectItem key={profile.id} value={profile.id.toString()} className="text-xs">
                           {profile.name}
                         </SelectItem>
                       ))}
                     </SelectContent>
                   </Select>
                 </div>
                 <div>
                   <Label htmlFor="pair-loop-rounds" className="sr-only">
                     Max rounds
                   </Label>
                   <Input
                     id="pair-loop-rounds"
                     type="number"
                     min={1}
                     max={10}
                     value={maxRounds}
                     disabled={pairLoopActive}
                     onChange={(event) => setMaxRounds(Number(event.target.value))}
                     className="h-8 text-xs"
                   />
                 </div>
               </div>

               <div className="mt-3 flex gap-2">
                 {pairLoopActive ? (
                   <Button variant="outline" className="h-8 flex-1 gap-2" onClick={() => onStopPairLoop(task)}>
                     <Square size={13} />
                     Stop Pair Loop
                   </Button>
                 ) : (
                   <Button
                     variant="outline"
                     className="h-8 flex-1 gap-2"
                     disabled={!reviewerProfileId || reviewerProfiles.length === 0}
                     onClick={() => {
                       if (!reviewerProfileId) return;
                       onStartPairLoop(task, reviewerProfileId, Math.min(10, Math.max(1, maxRounds || 3)));
                     }}
                   >
                     <Play size={13} />
                     Start Pair Loop
                   </Button>
                 )}
               </div>

               {latestReviewRun && (
                 <div className="review-run-summary">
                   <div className="flex items-center justify-between gap-2">
                     <span className="text-xs font-semibold">Review {latestReviewRun.round}</span>
                     <Badge variant="outline" className="rounded-md">
                       {reviewVerdictLabels[latestReviewRun.verdict]}
                     </Badge>
                   </div>
                   <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
                     {latestReviewRun.error ?? latestReviewRun.output}
                   </p>
                 </div>
               )}
             </section>
          </div>

          <div
            role="separator"
            aria-label="Resize terminal"
            aria-orientation="horizontal"
            aria-valuemin={MIN_TERMINAL_HEIGHT}
            aria-valuemax={terminalHeightLimit}
            aria-valuenow={terminalHeight}
            tabIndex={0}
            title="Drag to resize terminal"
            className="terminal-resize-handle"
            onPointerDown={handleTerminalResizePointerDown}
            onKeyDown={handleTerminalResizeKeyDown}
          />

          <section
            className="detail-terminal-panel flex min-h-0 flex-col"
            aria-label="Agent terminal"
            style={{ height: terminalHeight }}
          >
             <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3 border-b">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest opacity-60">
                  <TerminalSquare size={14} />
                  Agent Terminal
                </div>
             </div>
             <div className="flex-1 min-h-0 bg-[#0A0A0A]">
                <TerminalPane
                  sessionId={task.activeSessionId}
                  onSessionExit={onSessionExit}
                  onSessionInput={onSessionInput}
                />
             </div>
          </section>
        </div>
      </aside>
    );
  }
