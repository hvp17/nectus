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
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { JiraAvatar, JiraIssueTypeIcon, JiraPriorityIcon } from "./jiraVisuals";
import { AgentLogo } from "./AgentBrand";
import { cn } from "../lib/utils";
import type { JiraColumn } from "../hooks/useJira";
import { TASK_STATUS_LABELS } from "../statusLabels";
import type {
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
}

const FILTER_VALUES = { mine: "mine", hideDone: "hideDone", sprint: "sprint" } as const;

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
}: JiraBoardPageProps) {
  const ready = Boolean(status?.installed && status?.authenticated);
  const itemsByKey = new Map(columns.flatMap((column) => column.items).map((item) => [item.key, item]));

  // Group local tasks by the JIRA story they are attached to, so each card can
  // list its own sessions without re-scanning the whole task list per render.
  const tasksByKey = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (!task.jiraIssueKey) continue;
    const bucket = tasksByKey.get(task.jiraIssueKey);
    if (bucket) bucket.push(task);
    else tasksByKey.set(task.jiraIssueKey, [task]);
  }

  const activeFilters: string[] = [];
  if (filters.myIssues) activeFilters.push(FILTER_VALUES.mine);
  if (filters.unresolved) activeFilters.push(FILTER_VALUES.hideDone);
  if (filters.currentSprint) activeFilters.push(FILTER_VALUES.sprint);

  return (
    <div className="jira-board" data-testid="jira-board">
      <header className="jira-board-header flex flex-wrap items-center gap-3 border-b p-4">
        <div className="mr-auto">
          <p className="eyebrow">JIRA</p>
          <h1 className="text-xl font-bold tracking-tight">Board</h1>
        </div>
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
        <div className="jira-board-toolbar flex flex-wrap items-center gap-3 border-b p-4">
          <Select
            value={project ?? undefined}
            onValueChange={(value) => onChangeConfig({ project: value })}
          >
            <SelectTrigger className="h-9 w-64" aria-label="JIRA project">
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

          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={activeFilters}
            onValueChange={(values) =>
              onChangeConfig({
                myIssues: values.includes(FILTER_VALUES.mine),
                unresolved: values.includes(FILTER_VALUES.hideDone),
                currentSprint: values.includes(FILTER_VALUES.sprint),
              })
            }
            disabled={!project}
            aria-label="Board filters"
          >
            <ToggleGroupItem value={FILTER_VALUES.mine}>My issues</ToggleGroupItem>
            <ToggleGroupItem value={FILTER_VALUES.hideDone}>Hide done</ToggleGroupItem>
            <ToggleGroupItem value={FILTER_VALUES.sprint}>Current sprint</ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

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
    </div>
  );
}

function JiraConnection({ status }: { status: JiraStatus | undefined }) {
  if (!status) return <Skeleton className="h-5 w-28" />;
  if (!status.installed) return <Badge variant="destructive">acli not installed</Badge>;
  if (!status.authenticated) return <Badge variant="destructive">Not authenticated</Badge>;
  return (
    <Badge variant="secondary" className="gap-1">
      <span className="size-2 rounded-full bg-status-success" aria-hidden="true" />
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
  onTransition,
  onOpenItem,
  onOpenTask,
  onCreateTask,
}: BoardBodyProps) {
  if (!status?.installed) {
    return (
      <BoardEmpty title="Atlassian CLI not found">
        Install the Atlassian CLI (<code>acli</code>) and reopen this view.
      </BoardEmpty>
    );
  }
  if (!status.authenticated) {
    return (
      <BoardEmpty title="Not signed in to JIRA">
        Run <code>acli jira auth login</code> in a terminal, then reopen this view.
      </BoardEmpty>
    );
  }
  if (!project) {
    return (
      <BoardEmpty title="Choose a project">
        Pick a JIRA project above to load its board. No query to write, just choose a
        project and optional filters.
      </BoardEmpty>
    );
  }
  if (loading && columns.length === 0) {
    return (
      <div className="jira-board-columns flex gap-4 overflow-x-auto p-4">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-64 w-72 shrink-0" />
        ))}
      </div>
    );
  }
  if (columns.length === 0) {
    return (
      <BoardEmpty title="No matching stories">
        This project and filter combination returned no work items. Adjust the filters
        above.
      </BoardEmpty>
    );
  }

  return (
    <div className="jira-board-columns flex gap-4 overflow-x-auto p-4">
      {columns.map((column) => (
        <section
          key={column.statusName}
          className="jira-column flex w-72 shrink-0 flex-col rounded-lg border bg-muted/10"
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
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <span
                className="size-2 rounded-full"
                style={{ background: CATEGORY_DOT[column.category] }}
                aria-hidden="true"
              />
              {column.statusName}
            </span>
            <Badge variant="secondary">{column.items.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 p-2">
            {column.items.map((item) => (
              <JiraCard
                key={item.key}
                item={item}
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
  linkedTasks,
  onOpen,
  onOpenTask,
  onCreateTask,
}: {
  item: JiraWorkItem;
  linkedTasks: TaskSummary[];
  onOpen: () => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: () => void;
}) {
  return (
    <article
      className="jira-card group cursor-pointer rounded-md border border-border/70 bg-card p-2.5 shadow-sm transition hover:border-primary/40 hover:shadow-md"
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
      <p className="line-clamp-3 text-sm leading-snug text-foreground">{item.summary}</p>
      <div className="mt-2.5 flex items-center gap-1.5">
        <JiraIssueTypeIcon type={item.issueType} />
        <span
          className={cn(
            "font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
            item.statusCategory === "done" && "text-muted-foreground/60 line-through",
          )}
        >
          {item.key}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <JiraPriorityIcon priority={item.priority} />
          <JiraAvatar name={item.assignee} />
        </span>
      </div>

      {linkedTasks.length > 0 && (
        <LinkedTasks tasks={linkedTasks} onOpenTask={onOpenTask} />
      )}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2 h-7 w-full justify-center gap-1 text-xs opacity-0 transition group-hover:opacity-100"
        onClick={(event) => {
          event.stopPropagation();
          onCreateTask();
        }}
      >
        <Plus className="size-3.5" />
        Create task
      </Button>
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
    <div className="mt-2.5 border-t pt-2.5">
      <p className="mb-1.5 flex items-center gap-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
        Tasks
        <span className="text-muted-foreground/70">{tasks.length}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              title={task.title}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-accent"
              onClick={(event) => {
                event.stopPropagation();
                onOpenTask(task.id);
              }}
            >
              <AgentLogo agentKind={task.agentKind ?? "custom"} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{task.title}</span>
              {task.activeSessionId ? (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-primary">
                  <span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
                  Running
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {TASK_STATUS_LABELS[task.status]}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoardEmpty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-8">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{children}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
