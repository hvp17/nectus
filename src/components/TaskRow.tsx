import {
  Alert01Icon,
  CheckmarkCircle02Icon,
  GitBranchIcon,
  RadioIcon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { AgentLogo } from "./AgentBrand";
import { SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { formatAttentionReason, type TaskAttention } from "../sessionAttention";
import { TASK_STATUS_LABELS } from "../statusLabels";
import type { AgentKind, TaskSummary } from "../types";

export type TaskRowTone = "needs_input" | "idle" | "running" | "review" | "in_progress" | "planned" | "done";

interface TaskRowProps {
  task: TaskSummary;
  attention?: TaskAttention;
  isActive: boolean;
  onOpenTask: (taskId: number) => void;
  onStopSession: (sessionId: string) => void;
}

export function TaskRow({ task, attention, isActive, onOpenTask, onStopSession }: TaskRowProps) {
  const rowStatus = getTaskRowStatus(task, attention);
  const agentKind: AgentKind = task.agentKind ?? "custom";
  const statusLabel = TASK_STATUS_LABELS[task.status];

  return (
    <SidebarMenuItem className="task-tree-task" data-tone={rowStatus.tone}>
      <SidebarMenuButton
        type="button"
        size="lg"
        isActive={isActive}
        className="task-tree-open"
        aria-label={`Open ${task.title}`}
        onClick={() => onOpenTask(task.id)}
      >
        <span className="task-tree-status-icon" aria-hidden="true">
          {rowStatus.icon}
        </span>
        <span className="task-tree-main">
          <span className="task-tree-title">{task.title}</span>
          <span className="task-tree-meta">
            <AgentLogo agentKind={agentKind} size="sm" />
            {rowStatus.label && (
              <>
                <span>{rowStatus.label}</span>
                <span aria-hidden="true">/</span>
              </>
            )}
            <span>{statusLabel}</span>
            {task.hasWorktree && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="task-tree-location"
                    aria-label={`Worktree: ${task.branchName}`}
                    tabIndex={0}
                  >
                    <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} aria-hidden="true" />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {task.branchName}
                </TooltipContent>
              </Tooltip>
            )}
            {task.jiraIssueKey && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="task-tree-jira font-mono"
                    aria-label={`JIRA ${task.jiraIssueKey}`}
                    tabIndex={0}
                  >
                    {task.jiraIssueKey}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {task.jiraIssueSummary ?? task.jiraIssueKey}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
          {rowStatus.detail && <span className="task-tree-detail">{rowStatus.detail}</span>}
        </span>
      </SidebarMenuButton>

      {task.activeSessionId && (
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarMenuAction
              type="button"
              showOnHover
              className="task-tree-stop"
              aria-label={`Stop ${task.title}`}
              onClick={() => task.activeSessionId && onStopSession(task.activeSessionId)}
            >
              <HugeiconsIcon icon={StopCircleIcon} strokeWidth={2} aria-hidden="true" />
            </SidebarMenuAction>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">
            Stop session
          </TooltipContent>
        </Tooltip>
      )}
    </SidebarMenuItem>
  );
}

function getTaskRowStatus(
  task: TaskSummary,
  attention?: TaskAttention,
): {
  tone: TaskRowTone;
  label?: string;
  detail?: string;
  icon: ReactNode;
} {
  if (attention?.kind === "needs_input") {
    return {
      tone: "needs_input",
      label: "Needs input",
      detail: formatAttentionReason(attention.reason),
      icon: <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} aria-hidden="true" />,
    };
  }

  if (attention?.kind === "idle") {
    return {
      tone: "idle",
      label: "Finished",
      detail: attention.message ?? undefined,
      icon: <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} aria-hidden="true" />,
    };
  }

  if (task.activeSessionId) {
    return {
      tone: "running",
      label: "Running",
      icon: <HugeiconsIcon icon={RadioIcon} strokeWidth={2} aria-hidden="true" />,
    };
  }

  return {
    tone: task.status,
    icon: <span className="task-tree-status-dot" aria-hidden="true" />,
  };
}
