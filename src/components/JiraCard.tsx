import { Plus } from "lucide-react";
import { JiraAvatar, JiraIssueTypeIcon, JiraPriorityIcon } from "./jiraVisuals";
import { AgentLogo } from "./AgentBrand";
import { TASK_STATUS_LABELS } from "../statusLabels";
import type { JiraWorkItem, TaskSummary } from "../types";

export function JiraCard({
  item,
  done,
  selected,
  linkedTasks,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  item: JiraWorkItem;
  done: boolean;
  selected?: boolean;
  linkedTasks: TaskSummary[];
  onOpen: () => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: () => void;
}) {
  return (
    <article
      className="nx-jira-card"
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
      <div className="nx-jira-summary">{item.summary}</div>
      <div className="nx-jira-foot">
        <JiraIssueTypeIcon type={item.issueType} className="nx-jtype" />
        <span className={`nx-jira-key${done ? " done" : ""}`}>{item.key}</span>
        <span className="nx-jira-foot-right">
          <JiraPriorityIcon priority={item.priority} className="nx-jprio" />
          <JiraAvatar name={item.assignee} className={item.assignee ? "nx-java" : "nx-java empty"} />
        </span>
      </div>

      {linkedTasks.length > 0 && (
        <LinkedTasks tasks={linkedTasks} onOpenTask={onOpenTask} />
      )}

      <button
        type="button"
        className="nx-jira-create"
        onClick={(event) => {
          event.stopPropagation();
          onCreateTask();
        }}
      >
        <Plus />
        Create task
      </button>
    </article>
  );
}

/// The Nectus sessions attached to a story. Each chip opens its task in the
/// dashboard; a live session shows a pulsing dot in place of its status label.
function LinkedTasks({
  tasks,
  onOpenTask,
}: {
  tasks: TaskSummary[];
  onOpenTask: (taskId: number) => void;
}) {
  return (
    <div className="nx-jira-linked">
      <div className="nx-jira-linked-l">
        Tasks
        <span style={{ fontFamily: "var(--font-mono)" }}>{tasks.length}</span>
      </div>
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          title={task.title}
          className="nx-jlink"
          onClick={(event) => {
            event.stopPropagation();
            onOpenTask(task.id);
          }}
        >
          <AgentLogo agentKind={task.agentKind ?? "custom"} size="sm" />
          <span className="nx-jl-t">{task.title}</span>
          {task.activeSessionId ? (
            <span className="nx-jl-run">
              <span className="nx-livedot live-dot" aria-hidden="true" />
              Running
            </span>
          ) : (
            <span className="nx-jl-st">{TASK_STATUS_LABELS[task.status]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
