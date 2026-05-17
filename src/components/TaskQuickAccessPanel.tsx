import { AlertTriangle, CircleCheckBig, CircleStop, GitBranch, Radio } from "lucide-react";
import type { ReactNode } from "react";
import { AgentLogo } from "./AgentBrand";
import { Button } from "./ui/button";
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
    <section className="task-quick-access" aria-label="Tasks quick access">
      <div className="task-quick-access-header">
        <span className="eyebrow">Tasks</span>
        <span className="task-quick-access-count">{activeTasks.length}</span>
      </div>

      <div className="task-quick-access-list">
        {activeTasks.map((task) => {
          const attention = getTaskAttention(taskAttention, task.id);
          const quickStatus = getQuickStatus(attention);
          const location = task.hasWorktree ? task.branchName : "Task only";
          const agentKind: AgentKind = task.agentKind ?? "custom";

          return (
            <div
              className="task-quick-access-item"
              data-tone={quickStatus.tone}
              data-selected={selectedTaskId === task.id ? "true" : undefined}
              key={task.id}
            >
              <Button
                type="button"
                variant="ghost"
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
                    <span>{task.agentName ?? task.lastSessionAgent ?? "Agent"}</span>
                    <span aria-hidden="true">/</span>
                    <span>{quickStatus.label}</span>
                    <span aria-hidden="true">/</span>
                    <span>{taskStatusLabels[task.status]}</span>
                  </span>
                  <span className="task-quick-access-location">
                    <GitBranch size={11} aria-hidden="true" />
                    <span>{location}</span>
                  </span>
                  {quickStatus.detail && <span className="task-quick-access-detail">{quickStatus.detail}</span>}
                </span>
              </Button>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="task-quick-access-stop"
                    aria-label={`Stop ${task.title}`}
                    onClick={() => task.activeSessionId && onStopSession(task.activeSessionId)}
                  >
                    <CircleStop size={14} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Stop session
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </section>
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
      icon: <AlertTriangle size={13} />,
    };
  }

  if (attention?.kind === "idle") {
    return {
      tone: "idle",
      label: "Finished",
      detail: attention.message ?? undefined,
      icon: <CircleCheckBig size={13} />,
    };
  }

  return {
    tone: "running",
    label: "Running",
    icon: <Radio size={13} />,
  };
}
