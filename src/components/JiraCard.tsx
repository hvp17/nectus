import { Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { JiraAvatar, JiraIssueTypeIcon, JiraPriorityIcon } from "./jiraVisuals";
import { AgentLogo } from "./AgentBrand";
import { TASK_STATUS_LABELS } from "../statusLabels";
import type { JiraWorkItem, TaskSummary } from "../types";

export function JiraCard({
  item,
  done,
  selected,
  linkedTasks,
  showStatus,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  item: JiraWorkItem;
  done: boolean;
  selected?: boolean;
  linkedTasks: TaskSummary[];
  /** Show the item's status as a pill (used in Sprint view, which has no status columns). */
  showStatus?: boolean;
  onOpen: () => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: () => void;
}) {
  return (
    <article
      className="group flex w-full cursor-pointer flex-col rounded-md bg-card px-3 py-[11px] text-left ring-1 ring-border transition-shadow hover:shadow-sm hover:ring-primary/40"
      data-selected={selected ? "true" : undefined}
      style={selected ? { boxShadow: "0 0 0 1.5px var(--primary)" } : undefined}
      draggable
      onDragStart={(event) => event.dataTransfer.setData("text/plain", item.key)}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="line-clamp-3 text-[13px] leading-[1.4] text-foreground">{item.summary}</div>
      <div className="mt-[11px] flex items-center gap-[7px]">
        <JiraIssueTypeIcon type={item.issueType} />
        <span
          className={cn(
            "font-mono text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground",
            done && "line-through",
          )}
        >
          {item.key}
        </span>
        {showStatus && (
          <span
            className="whitespace-nowrap rounded-full bg-muted/70 px-[7px] py-px text-[10px] font-semibold text-muted-foreground data-[cat=in_progress]:bg-primary/15 data-[cat=in_progress]:text-primary data-[cat=done]:bg-status-success/20 data-[cat=done]:text-status-success"
            data-cat={item.statusCategory}
          >
            {item.statusName}
          </span>
        )}
        <span className="ml-auto flex items-center gap-[7px]">
          <JiraPriorityIcon priority={item.priority} />
          <JiraAvatar name={item.assignee} />
        </span>
      </div>

      {linkedTasks.length > 0 && (
        <LinkedTasks tasks={linkedTasks} onOpenTask={onOpenTask} />
      )}

      <button
        type="button"
        className="mt-[9px] hidden h-7 w-full cursor-pointer items-center justify-center gap-[5px] rounded-[6px] border border-dashed border-border bg-transparent text-[11.5px] font-semibold text-muted-foreground hover:border-primary hover:text-primary group-hover:flex group-focus-within:flex"
        onClick={(event) => {
          event.stopPropagation();
          onCreateTask();
        }}
      >
        <Plus className="size-[13px]" />
        Create task
      </button>
    </article>
  );
}

/// The Nectus tasks attached to a story. Each chip opens its task in the
/// dashboard.
function LinkedTasks({
  tasks,
  onOpenTask,
}: {
  tasks: TaskSummary[];
  onOpenTask: (taskId: number) => void;
}) {
  return (
    <div className="mt-[11px] border-t border-border pt-2.5">
      <div className="mb-1.5 flex items-center gap-[5px] text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-muted-foreground">
        Tasks
        <span className="font-mono">{tasks.length}</span>
      </div>
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          title={task.title}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[6px] px-[7px] py-[5px] text-left hover:bg-foreground/5"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTask(task.id);
          }}
        >
          <AgentLogo agentKind={task.agentKind ?? "custom"} size="sm" />
          <span className="line-clamp-2 min-w-0 flex-1 text-[11.5px] font-medium leading-[1.3]">
            {task.title}
          </span>
          <span className="flex-none text-[9.5px] text-muted-foreground">
            {TASK_STATUS_LABELS[task.status]}
          </span>
        </button>
      ))}
    </div>
  );
}
