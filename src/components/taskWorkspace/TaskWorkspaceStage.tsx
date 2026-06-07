import { Fragment, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileDiff,
  LoaderCircle,
  RotateCw,
  ScanEye,
  TerminalSquare,
} from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperTitle,
  StepperTrigger,
} from "../reui/stepper";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { Separator } from "../ui/separator";
import { TaskDiffView } from "../TaskDiffView";
import { ReviewTerminalPane } from "../ReviewTerminalPane";
import { TerminalPane } from "../../TerminalPane";
import { cn } from "../../lib/utils";
import type { TaskAttention } from "../../sessionAttention";
import type { useTaskDiff } from "../../hooks/useTaskDiff";
import type { TaskSummary } from "../../types";
import { ActionBar } from "./ActionBar";
import { EditableTaskTitle } from "./EditableTaskTitle";
import { TaskStatusBadges } from "./TaskStatusBadges";
import { TaskTerminalLauncher } from "./TaskTerminalLauncher";

type StageTab = "terminal" | "diff" | "review";
type TaskDiff = ReturnType<typeof useTaskDiff>;

/// One step of the task workflow ribbon. `action` is the inline control rendered
/// only while the step is current.
export interface WorkflowStep {
  title: string;
  description: string;
  completed: boolean;
  loading: boolean;
  disabled: boolean;
  action: ReactNode;
}

export interface TaskWorkspaceStageProps {
  task: TaskSummary;
  backLabel: string;
  onClose: () => void;
  workflowStep: number;
  workflowSteps: WorkflowStep[];
  onRenameTask: (task: TaskSummary, title: string) => void;
  stageTab: StageTab;
  onStageTabChange: (tab: StageTab) => void;
  diff: TaskDiff;
  diffFileCount: number;
  diffTotals: { additions: number; deletions: number };
  reviewOutput: string;
  reviewInProgress: boolean;
  attention?: TaskAttention;
  displayedAttentionDetail?: string | null;
  attentionDetail?: string | null;
  isAttentionDetailTruncated: boolean;
  canCreatePullRequest: boolean;
  onCreatePullRequest: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onSessionExit: (sessionId: string) => void;
  onSessionInput: (sessionId: string) => void;
  canResumeSession: boolean;
  onResumeSession: (task: TaskSummary) => void;
  onStartSession: (task: TaskSummary) => void;
}

/// The working stage: header, the workflow ribbon, and the
/// `Terminal | Diff | Review` toggle with its active surface and attention bar.
export function TaskWorkspaceStage({
  task,
  backLabel,
  onClose,
  workflowStep,
  workflowSteps,
  onRenameTask,
  stageTab,
  onStageTabChange,
  diff,
  diffFileCount,
  diffTotals,
  reviewOutput,
  reviewInProgress,
  attention,
  displayedAttentionDetail,
  attentionDetail,
  isAttentionDetailTruncated,
  canCreatePullRequest,
  onCreatePullRequest,
  onSessionExit,
  onSessionInput,
  canResumeSession,
  onResumeSession,
  onStartSession,
}: TaskWorkspaceStageProps) {
  return (
    <main className="flex min-h-0 min-w-0 flex-col gap-3 bg-gradient-to-b from-muted/25 to-transparent to-30% p-4">
      <header className="task-workspace-header">
        <div className="task-workspace-heading">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={onClose}
            aria-label="Back to task board"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {backLabel}
          </Button>
          <Separator orientation="vertical" className="h-5 shrink-0" />
          <EditableTaskTitle title={task.title} onRename={(title) => onRenameTask(task, title)} />
        </div>
        <div className="task-workspace-badges">
          <TaskStatusBadges task={task} />
        </div>
      </header>

      {/* the rework: workflow as a horizontal ribbon, always visible above the terminal */}
      <Stepper
        value={workflowStep}
        orientation="horizontal"
        indicators={{
          completed: <Check className="size-3.5" />,
          loading: <LoaderCircle className="size-3.5 animate-spin" />,
        }}
      >
        <StepperNav className="flex w-full items-center rounded-lg border bg-card p-1 shadow-xs">
          {workflowSteps.map((step, index) => (
            <Fragment key={step.title}>
              {index > 0 && (
                <span className="flex w-3.5 shrink-0 select-none items-center justify-center self-center text-border">
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              )}
              <StepperItem
                step={index + 1}
                completed={step.completed}
                disabled={step.disabled}
                loading={step.loading}
                className="flex-1 rounded-md data-[state=active]:bg-primary/[0.11]"
              >
                <StepperTrigger className="flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left">
                  <StepperIndicator className="size-6 rounded-full border-[1.5px] border-border bg-background text-[11px] font-bold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-primary data-[state=completed]:border-primary data-[state=completed]:bg-primary data-[state=completed]:text-primary-foreground">
                    {index + 1}
                  </StepperIndicator>
                  <span className="min-w-0">
                    <StepperTitle className="text-[12.5px] font-bold leading-tight data-[state=completed]:text-muted-foreground">
                      {step.title}
                    </StepperTitle>
                    <StepperDescription className="mt-0.5 truncate text-[11px]">
                      {step.description}
                    </StepperDescription>
                  </span>
                </StepperTrigger>

                {index + 1 === workflowStep && step.action && (
                  <div className="flex shrink-0 items-center gap-1.5 self-center pl-1 pr-2">
                    {step.action}
                  </div>
                )}
              </StepperItem>
            </Fragment>
          ))}
        </StepperNav>
      </Stepper>

      <section
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border bg-card shadow-lg"
        aria-label="Agent workspace stage"
      >
        <div className="flex items-center justify-between gap-2 border-b px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ToggleGroup
              type="single"
              value={stageTab}
              onValueChange={(value) => value && onStageTabChange(value as StageTab)}
              variant="outline"
            >
              <ToggleGroupItem value="terminal" aria-label="Show terminal" className="h-7 gap-1.5 px-2.5 text-xs">
                <TerminalSquare className="size-3.5" aria-hidden="true" />
                Terminal
              </ToggleGroupItem>
              <ToggleGroupItem value="diff" aria-label="Show diff" className="h-7 gap-1.5 px-2.5 text-xs">
                <FileDiff className="size-3.5" aria-hidden="true" />
                Diff
                {diffFileCount > 0 && (
                  <Badge variant="secondary" className="ml-0.5 h-4 min-w-4 justify-center px-1 text-[10px]">
                    {diffFileCount}
                  </Badge>
                )}
              </ToggleGroupItem>
              <ToggleGroupItem value="review" aria-label="Show reviewer terminal" className="h-7 gap-1.5 px-2.5 text-xs">
                <ScanEye className="size-3.5" aria-hidden="true" />
                Review
                {reviewInProgress && <span className="dot live-dot bg-primary" aria-hidden="true" />}
              </ToggleGroupItem>
            </ToggleGroup>

            {(diffTotals.additions > 0 || diffTotals.deletions > 0) && (
              <span
                className="flex shrink-0 items-center gap-2 font-mono text-xs font-semibold tabular-nums"
                aria-label={`${diffTotals.additions} additions, ${diffTotals.deletions} deletions`}
              >
                <span className="text-status-success">+{diffTotals.additions}</span>
                <span className="text-destructive">-{diffTotals.deletions}</span>
              </span>
            )}
          </div>

          {stageTab === "diff" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              aria-label="Refresh diff"
              disabled={diff.loading}
              onClick={() => void diff.refresh()}
            >
              <RotateCw data-icon="inline-start" className={cn(diff.loading && "animate-spin")} />
              Refresh
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {stageTab === "diff" ? (
            <TaskDiffView
              summary={diff.summary}
              loading={diff.loading}
              error={diff.error}
              files={diff.files}
              onSelectFile={diff.loadFile}
            />
          ) : stageTab === "review" ? (
            <ReviewTerminalPane output={reviewOutput} active={reviewInProgress} />
          ) : task.activeSessionId ? (
            <TerminalPane sessionId={task.activeSessionId} onSessionExit={onSessionExit} onSessionInput={onSessionInput} />
          ) : (
            <TaskTerminalLauncher
              task={task}
              canResumeSession={canResumeSession}
              onResumeSession={onResumeSession}
              onStartSession={onStartSession}
            />
          )}
        </div>

        {attention && stageTab === "terminal" && (
          <ActionBar
            attention={attention}
            agentName={task.agentName}
            detail={displayedAttentionDetail}
            detailTitle={isAttentionDetailTruncated ? attentionDetail ?? undefined : undefined}
            prUrl={task.prUrl}
            canCreatePullRequest={canCreatePullRequest}
            onCreatePullRequest={() => onCreatePullRequest(task)}
          />
        )}
      </section>
    </main>
  );
}
