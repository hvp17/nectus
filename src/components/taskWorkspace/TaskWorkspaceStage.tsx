import { Fragment, lazy, Suspense, useCallback, type ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileDiff,
  LoaderCircle,
  MessagesSquare,
  RotateCw,
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
import { cn } from "../../lib/utils";
import type { TaskAttention } from "../../sessionAttention";
import type { useTaskDiff } from "../../hooks/useTaskDiff";
import type { TaskSummary } from "../../types";
import { ActionBar } from "./ActionBar";
import { EditableTaskTitle } from "./EditableTaskTitle";
import { TaskStatusBadges } from "./TaskStatusBadges";

type StageTab = "diff" | "chat";
type TaskDiff = ReturnType<typeof useTaskDiff>;

const TaskDiffView = lazy(() => import("../TaskDiffView").then((module) => ({ default: module.TaskDiffView })));
const ChatPane = lazy(() => import("../chat/ChatPane").then((module) => ({ default: module.ChatPane })));

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
  /** Cross-repo member switcher shown with the Diff controls (null for single-repo tasks). */
  repoScopePicker?: React.ReactNode;
  /** File path requested by another surface, such as a chat file chip. */
  diffSelectedFile?: string | null;
  diff: TaskDiff;
  diffFileCount: number;
  diffTotals: { additions: number; deletions: number };
  attention?: TaskAttention;
  displayedAttentionDetail?: string | null;
  attentionDetail?: string | null;
  isAttentionDetailTruncated: boolean;
  canCreatePullRequest: boolean;
  onCreatePullRequest: (task: TaskSummary, options?: { draft?: boolean }) => void;
  onOpenChatFile?: (path: string) => void;
}

/// The working stage: header, the workflow ribbon, and the `Chat | Diff` toggle
/// with its active surface and attention bar.
export function TaskWorkspaceStage({
  task,
  backLabel,
  onClose,
  workflowStep,
  workflowSteps,
  onRenameTask,
  stageTab,
  onStageTabChange,
  repoScopePicker,
  diffSelectedFile,
  diff,
  diffFileCount,
  diffTotals,
  attention,
  displayedAttentionDetail,
  attentionDetail,
  isAttentionDetailTruncated,
  canCreatePullRequest,
  onCreatePullRequest,
  onOpenChatFile,
}: TaskWorkspaceStageProps) {
  // Stable so ChatPane's memoized parts aren't re-rendered on every chat snapshot.
  const handleOpenChatFile = useCallback(
    (path: string) => {
      onOpenChatFile?.(path);
      onStageTabChange("diff");
    },
    [onOpenChatFile, onStageTabChange],
  );

  return (
    <main className="flex min-h-0 min-w-0 flex-col gap-3 bg-gradient-to-b from-muted/25 to-transparent to-30% p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-3">
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
        <div className="ml-auto flex flex-wrap items-center gap-1.5 max-[1040px]:ml-0 max-[1040px]:w-full">
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
              <ToggleGroupItem value="chat" aria-label="Show chat" className="h-7 gap-1.5 px-2.5 text-xs">
                <MessagesSquare className="size-3.5" aria-hidden="true" />
                Chat
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
            <>
              {repoScopePicker}
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
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="h-full" />}>
            {stageTab === "chat" ? (
              <ChatPane taskId={task.id} agentProfileId={task.agentProfileId} onOpenFile={handleOpenChatFile} />
            ) : stageTab === "diff" ? (
              <TaskDiffView
                summary={diff.summary}
                loading={diff.loading}
                error={diff.error}
                files={diff.files}
                selectedFile={diffSelectedFile}
                onSelectFile={diff.loadFile}
              />
            ) : null}
          </Suspense>
        </div>

        {attention && stageTab === "chat" && (
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
