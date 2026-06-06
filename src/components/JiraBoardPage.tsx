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
import { BoardBody } from "./JiraBoardBody";
import { JiraWorkItemPanel } from "./JiraWorkItemDialog";
import { JiraCreateWorkItemPanel } from "./JiraCreateWorkItemPanel";
import type { JiraColumn } from "../hooks/useJira";
import type {
  AgentProfile,
  JiraProject,
  JiraStatus,
  JiraWorkItem,
  TaskSummary,
} from "../types";

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
  /** Create-work-item panel state; shares the dock slot with the view panel. */
  createOpen?: boolean;
  onOpenCreate?: () => void;
  onCloseCreate?: () => void;
  onCreateWorkItem?: (input: {
    project: string;
    issueType: string;
    summary: string;
    description?: string;
    assignee?: string;
    labels?: string;
  }) => Promise<JiraWorkItem | null>;
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
  createOpen,
  onOpenCreate,
  onCloseCreate,
  onCreateWorkItem,
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

  // The right-hand dock slot holds at most one panel: the create form takes
  // precedence over the work-item view (they are kept mutually exclusive upstream).
  const dockedPanel =
    createOpen && onCloseCreate && onCreateWorkItem ? (
      <JiraCreateWorkItemPanel
        projects={projects}
        defaultProject={project}
        onClose={onCloseCreate}
        onCreate={onCreateWorkItem}
      />
    ) : selectedItem && onCloseItem ? (
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
    ) : null;

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

          {onOpenCreate && (
            <Button
              type="button"
              size="sm"
              className="ml-auto gap-2"
              disabled={!project}
              onClick={onOpenCreate}
            >
              <Plus className="size-4" />
              New work item
            </Button>
          )}
        </div>
      )}

      {dockedPanel ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_372px] overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-hidden">
            <BoardBody
              status={status}
              project={project}
              loading={loading}
              columns={columns}
              itemsByKey={itemsByKey}
              tasksByKey={tasksByKey}
              selectedKey={selectedItem?.key}
              onTransition={onTransition}
              onOpenItem={onOpenItem}
              onOpenTask={onOpenTask}
              onCreateTask={onCreateTask}
            />
          </div>
          {dockedPanel}
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
