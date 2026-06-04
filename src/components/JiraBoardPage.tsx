import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { JiraAvatar, JiraIssueTypeIcon, JiraPriorityIcon } from "./jiraVisuals";
import { AgentLogo } from "./AgentBrand";
import { JiraWorkItemPanel } from "./JiraWorkItemDialog";
import type { JiraColumn } from "../hooks/useJira";
import { TASK_STATUS_LABELS } from "../statusLabels";
import type {
  AgentProfile,
  JiraProject,
  JiraStatus,
  JiraStatusCategory,
  JiraWorkItem,
  TaskSummary,
} from "../types";

const CATEGORY_DOT: Record<JiraStatusCategory, string> = {
  to_do: "var(--muted-foreground)",
  in_progress: "var(--primary)",
  done: "var(--status-success)",
  unknown: "var(--muted-foreground)",
};

export interface JiraBoardFilters {
  myIssues: boolean;
  unresolved: boolean;
  currentSprint: boolean;
}

export interface JiraBoardConfigChange {
  project?: string | null;
  myIssues?: boolean;
  unresolved?: boolean;
  currentSprint?: boolean;
}

interface JiraBoardPageProps {
  status: JiraStatus | undefined;
  projects: JiraProject[];
  /** Local Nectus tasks, used to surface the ones attached to each story. */
  tasks: TaskSummary[];
  project: string | null;
  filters: JiraBoardFilters;
  columns: JiraColumn[];
  loading: boolean;
  onChangeConfig: (partial: JiraBoardConfigChange) => void;
  onRefresh: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (item: JiraWorkItem) => void;
  /** When set, the board splits to dock the work-item side panel beside it. */
  selectedItem?: JiraWorkItem | null;
  onCloseItem?: () => void;
  agentProfiles?: AgentProfile[];
  selectedAgentProfileId?: number;
  site?: string | null;
  onAssign?: (key: string, assignee: string) => void;
  onComment?: (key: string, body: string) => void;
  onPickAgent?: (profileId: number) => void;
  onOpenUrl?: (url: string) => void;
}

export function JiraBoardPage({
  status,
  projects,
  tasks,
  project,
  filters,
  columns,
  loading,
  onChangeConfig,
  onRefresh,
  onTransition,
  onOpenItem,
  onOpenTask,
  onCreateTask,
  selectedItem,
  onCloseItem,
  agentProfiles,
  selectedAgentProfileId,
  site,
  onAssign,
  onComment,
  onPickAgent,
  onOpenUrl,
}: JiraBoardPageProps) {
  const ready = Boolean(status?.installed && status?.authenticated);
  const itemsByKey = new Map(columns.flatMap((column) => column.items).map((item) => [item.key, item]));
  const statusOptions = columns.map((column) => column.statusName);

  // Group local tasks by the JIRA story they are attached to, so each card can
  // list its own sessions without re-scanning the whole task list per render.
  const tasksByKey = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (!task.jiraIssueKey) continue;
    const bucket = tasksByKey.get(task.jiraIssueKey);
    if (bucket) bucket.push(task);
    else tasksByKey.set(task.jiraIssueKey, [task]);
  }

  return (
    <div className="nx-jira" data-testid="jira-board">
      <header className="nx-jira-head">
        <h1>JIRA Board</h1>
        <JiraConnection status={status} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={!ready || !project || loading}
          className="gap-2"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {ready && (
        <div className="nx-jira-toolbar">
          <Select
            value={project ?? undefined}
            onValueChange={(value) => onChangeConfig({ project: value })}
          >
            <SelectTrigger className="h-9 w-56" aria-label="JIRA project">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((option) => (
                <SelectItem key={option.key} value={option.key}>
                  {option.name} ({option.key})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="nx-seg" role="group" aria-label="Board filters">
            <button
              type="button"
              data-on={filters.myIssues}
              aria-pressed={filters.myIssues}
              disabled={!project}
              onClick={() => onChangeConfig({ myIssues: !filters.myIssues })}
            >
              My issues
            </button>
            <button
              type="button"
              data-on={filters.unresolved}
              aria-pressed={filters.unresolved}
              disabled={!project}
              onClick={() => onChangeConfig({ unresolved: !filters.unresolved })}
            >
              Hide done
            </button>
            <button
              type="button"
              data-on={filters.currentSprint}
              aria-pressed={filters.currentSprint}
              disabled={!project}
              onClick={() => onChangeConfig({ currentSprint: !filters.currentSprint })}
            >
              Current sprint
            </button>
          </div>
        </div>
      )}

      {selectedItem && onCloseItem ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_372px] overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden">
            <BoardBody
              status={status}
              project={project}
              loading={loading}
              columns={columns}
              itemsByKey={itemsByKey}
              tasksByKey={tasksByKey}
              selectedKey={selectedItem.key}
              onTransition={onTransition}
              onOpenItem={onOpenItem}
              onOpenTask={onOpenTask}
              onCreateTask={onCreateTask}
            />
          </div>
          <JiraWorkItemPanel
            key={selectedItem.key}
            item={selectedItem}
            statusOptions={statusOptions}
            site={site}
            agentProfiles={agentProfiles ?? []}
            selectedAgentProfileId={selectedAgentProfileId}
            onClose={onCloseItem}
            onTransition={onTransition}
            onAssign={onAssign ?? (() => {})}
            onComment={onComment ?? (() => {})}
            onCreateTask={onCreateTask}
            onPickAgent={onPickAgent ?? (() => {})}
            onOpenUrl={onOpenUrl ?? (() => {})}
          />
        </div>
      ) : (
        <BoardBody
          status={status}
          project={project}
          loading={loading}
          columns={columns}
          itemsByKey={itemsByKey}
          tasksByKey={tasksByKey}
          onTransition={onTransition}
          onOpenItem={onOpenItem}
          onOpenTask={onOpenTask}
          onCreateTask={onCreateTask}
        />
      )}
    </div>
  );
}

function JiraConnection({ status }: { status: JiraStatus | undefined }) {
  if (!status) return <Skeleton className="h-5 w-28" />;
  if (!status.installed) return <Badge variant="destructive">acli not installed</Badge>;
  if (!status.authenticated) return <Badge variant="destructive">Not authenticated</Badge>;
  return (
    <Badge variant="secondary" className="gap-1.5">
      <span
        className="nx-livedot"
        style={{ background: "var(--status-success)" }}
        aria-hidden="true"
      />
      {status.site ?? "Connected"}
    </Badge>
  );
}

interface BoardBodyProps {
  status: JiraStatus | undefined;
  project: string | null;
  loading: boolean;
  columns: JiraColumn[];
  itemsByKey: Map<string, JiraWorkItem>;
  tasksByKey: Map<string, TaskSummary[]>;
  selectedKey?: string;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}

function BoardBody({
  status,
  project,
  loading,
  columns,
  itemsByKey,
  tasksByKey,
  selectedKey,
  onTransition,
  onOpenItem,
  onOpenTask,
  onCreateTask,
}: BoardBodyProps) {
  if (!status?.installed) {
    return (
      <BoardEmpty>
        Atlassian CLI not found. Install the Atlassian CLI (<code>acli</code>) and reopen this
        view.
      </BoardEmpty>
    );
  }
  if (!status.authenticated) {
    return (
      <BoardEmpty>
        Not signed in to JIRA. Run <code>acli jira auth login</code> in a terminal, then reopen
        this view.
      </BoardEmpty>
    );
  }
  if (!project) {
    return (
      <BoardEmpty>
        Choose a project above to load its board. No query to write, just pick a project and
        optional filters.
      </BoardEmpty>
    );
  }
  if (loading && columns.length === 0) {
    return (
      <div className="nx-jira-cols">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-64 w-72 shrink-0" />
        ))}
      </div>
    );
  }
  if (columns.length === 0) {
    return (
      <BoardEmpty>
        No matching stories. This project and filter combination returned no work items. Adjust
        the filters above.
      </BoardEmpty>
    );
  }

  return (
    <div className="nx-jira-cols">
      {columns.map((column) => (
        <section
          key={column.statusName}
          className="nx-jira-col"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const key = event.dataTransfer.getData("text/plain");
            const dragged = itemsByKey.get(key);
            if (dragged && dragged.statusName !== column.statusName) {
              onTransition(dragged, column.statusName);
            }
          }}
        >
          <div className="nx-jira-col-head">
            <span
              className="nx-dot"
              style={{ background: CATEGORY_DOT[column.category] }}
              aria-hidden="true"
            />
            <span className="nx-cl">{column.statusName}</span>
            <span className="nx-cc">
              <Badge variant="secondary">{column.items.length}</Badge>
            </span>
          </div>
          <div className="nx-jira-col-body">
            {column.items.map((item) => (
              <JiraCard
                key={item.key}
                item={item}
                done={column.category === "done"}
                selected={item.key === selectedKey}
                linkedTasks={tasksByKey.get(item.key) ?? []}
                onOpen={() => onOpenItem(item)}
                onOpenTask={onOpenTask}
                onCreateTask={() => onCreateTask(item)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function JiraCard({
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

function BoardEmpty({ children }: { children: React.ReactNode }) {
  return <div className="nx-jira-empty">{children}</div>;
}
