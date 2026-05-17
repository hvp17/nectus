import { Alert01Icon, CheckmarkCircle02Icon, GitBranchIcon, RadioIcon, StopCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { AgentLogo } from "./AgentBrand";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { formatAttentionReason, getTaskAttention, type TaskAttention } from "../sessionAttention";
import type { AgentKind, TaskStatus, TaskSummary } from "../types";

const taskStatusLabels: Record<TaskStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  review: "Review",
  done: "Done",
};

type QuickStatusTone = "running" | "idle" | "needs_input";

const quickStatusPriority: Record<QuickStatusTone, number> = {
  needs_input: 0,
  idle: 1,
  running: 2,
};

interface TaskQuickAccessPanelProps {
  tasks: TaskSummary[];
  taskAttention: TaskAttention[];
  selectedTaskId?: number;
  onOpenTask: (taskId: number) => void;
  onStopSession: (sessionId: string) => void;
}

export function TaskQuickAccessPanel({
  tasks,
  taskAttention,
  selectedTaskId,
  onOpenTask,
  onStopSession,
}: TaskQuickAccessPanelProps) {
  const activeTasks = tasks
    .filter((task) => Boolean(task.activeSessionId))
    .sort((left, right) => {
      const leftTone = getQuickStatusTone(getTaskAttention(taskAttention, left.id));
      const rightTone = getQuickStatusTone(getTaskAttention(taskAttention, right.id));
      return quickStatusPriority[leftTone] - quickStatusPriority[rightTone];
    });

  if (activeTasks.length === 0) {
    return null;
  }

  return (
    <SidebarGroup className="task-quick-access" role="region" aria-label="Tasks quick access">
      <div className="task-quick-access-header">
        <SidebarGroupLabel>Tasks</SidebarGroupLabel>
        <span className="task-quick-access-count">{activeTasks.length}</span>
      </div>

      <SidebarGroupContent>
        <SidebarMenu className="task-quick-access-list">
          {activeTasks.map((task) => {
            const attention = getTaskAttention(taskAttention, task.id);
            const quickStatus = getQuickStatus(attention);
            const agentKind: AgentKind = task.agentKind ?? "custom";

            return (
              <SidebarMenuItem className="task-quick-access-item" data-tone={quickStatus.tone} key={task.id}>
                <SidebarMenuButton
                  type="button"
                  size="lg"
                  isActive={selectedTaskId === task.id}
                  className="task-quick-access-open"
                  aria-label={`Open ${task.title}`}
                  onClick={() => onOpenTask(task.id)}
                >
                  <span className="task-quick-access-status-icon" aria-hidden="true">
                    {quickStatus.icon}
                  </span>
                  <span className="task-quick-access-main">
                    <span className="task-quick-access-title">{task.title}</span>
                    <span className="task-quick-access-meta">
                      <AgentLogo agentKind={agentKind} size="sm" />
                      <span>{quickStatus.label}</span>
                      <span aria-hidden="true">/</span>
                      <span>{taskStatusLabels[task.status]}</span>
                      {task.hasWorktree && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="task-quick-access-location"
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
                    </span>
                    {quickStatus.detail && <span className="task-quick-access-detail">{quickStatus.detail}</span>}
                  </span>
                </SidebarMenuButton>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <SidebarMenuAction
                      type="button"
                      showOnHover
                      className="task-quick-access-stop"
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
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function getQuickStatusTone(attention?: TaskAttention): QuickStatusTone {
  if (attention?.kind === "needs_input") return "needs_input";
  if (attention?.kind === "idle") return "idle";
  return "running";
}

function getQuickStatus(attention?: TaskAttention): {
  tone: QuickStatusTone;
  label: string;
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

  return {
    tone: "running",
    label: "Running",
    icon: <HugeiconsIcon icon={RadioIcon} strokeWidth={2} aria-hidden="true" />,
  };
}
