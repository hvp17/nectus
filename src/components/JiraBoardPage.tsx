import { LayoutGrid, ListFilter, Plus, RefreshCw, Rows3 } from "lucide-react";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { BoardBody } from "./JiraBoardBody";
import { SprintBody } from "./JiraSprintBody";
import { JiraWorkItemPanel } from "./JiraWorkItemDialog";
import { JiraCreateWorkItemPanel } from "./JiraCreateWorkItemPanel";
import type { JiraColumn } from "../hooks/useJira";
import type { JiraViewMode } from "../hooks/useJiraBoardView";
import type {
  AgentProfile,
  JiraProject,
  JiraSprintLane,
  JiraTransition,
  JiraWorkItem,
  TaskSummary,
} from "../types";

export interface JiraBoardFilters {
  myIssues: boolean;
  unresolved: boolean;
  currentSprint: boolean;
  statuses: string[];
  /** Selected epic key, or null for no epic filter. */
  epic: string | null;
}

export interface JiraBoardConfigChange {
  project?: string | null;
  myIssues?: boolean;
  unresolved?: boolean;
  currentSprint?: boolean;
  statuses?: string[];
  epic?: string | null;
}

/** Sentinel Select value for "no epic filter" (Select items can't be empty). */
const ALL_EPICS_VALUE = "__all_epics";

/** Stable empty default so an unset `sprintLanes` prop doesn't churn renders. */
const NO_LANES: JiraSprintLane[] = [];

/** Segmented-control track and button styles (the toolbar's Board/Sprint and filter toggles). */
const SEG_TRACK = "inline-flex gap-0.5 rounded-md border border-border bg-card p-0.5";
const SEG_BUTTON =
  "inline-flex h-7 cursor-pointer items-center rounded-[6px] bg-transparent px-[13px] text-[12.5px] font-semibold text-muted-foreground transition-colors data-[on=true]:bg-card data-[on=true]:text-foreground data-[on=true]:shadow-xs";

interface JiraBoardPageProps {
  projects: JiraProject[];
  /** Local Nectus tasks, used to surface the ones attached to each story. */
  tasks: TaskSummary[];
  project: string | null;
  filters: JiraBoardFilters;
  columns: JiraColumn[];
  loading: boolean;
  /** Board (status columns) vs Sprint (sprint lanes grouped by epic). Defaults to board. */
  viewMode?: JiraViewMode;
  onChangeViewMode?: (mode: JiraViewMode) => void;
  /** Sprint view data (loaded only in Sprint mode, REST-gated). */
  sprintLanes?: JiraSprintLane[];
  sprintLoading?: boolean;
  sprintError?: string | null;
  onChangeConfig: (partial: JiraBoardConfigChange) => void;
  onRefresh: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (item: JiraWorkItem, agentProfileId?: number) => void;
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
  /** API token connected — the JIRA connection; gates the whole board. */
  restConnected?: boolean;
  onListTransitions?: (key: string) => Promise<JiraTransition[]>;
  /** Statuses offered in the board's status filter (project set when connected). */
  filterableStatuses?: string[];
  /** Epics offered in the board's epic filter (from the selected project). */
  epics?: JiraWorkItem[];
  onAssign?: (key: string, assignee: string) => void;
  onComment?: (key: string, body: string) => void;
  onPickAgent?: (profileId: number) => void;
  onOpenUrl?: (url: string) => void;
}

export function JiraBoardPage({
  projects,
  tasks,
  project,
  filters,
  columns,
  loading,
  viewMode = "board",
  onChangeViewMode = () => {},
  sprintLanes = NO_LANES,
  sprintLoading = false,
  sprintError = null,
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
  restConnected,
  onListTransitions,
  filterableStatuses,
  epics,
  onAssign,
  onComment,
  onPickAgent,
  onOpenUrl,
}: JiraBoardPageProps) {
  const ready = Boolean(restConnected);
  const itemsByKey = new Map(columns.flatMap((column) => column.items).map((item) => [item.key, item]));
  const statusOptions = columns.map((column) => column.statusName);
  // Always include the currently-selected statuses so they stay uncheckable even
  // when the active filter leaves the board with no matching columns (otherwise a
  // user could filter to a status with zero items and be unable to clear it).
  const statusFilterOptions = Array.from(
    new Set([...(filterableStatuses ?? []), ...filters.statuses]),
  );

  // Epic options for the picker. Keep the currently-selected epic listed even if
  // it isn't (yet) in the fetched epics (still loading, or filtered out), so the
  // active selection always renders rather than collapsing to the placeholder.
  const epicList = epics ?? [];
  const epicOptions =
    filters.epic && !epicList.some((epic) => epic.key === filters.epic)
      ? [{ key: filters.epic, summary: "" } as JiraWorkItem, ...epicList]
      : epicList;

  const sprintView = viewMode === "sprint";
  const busy = sprintView ? sprintLoading : loading;

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
        restConnected={Boolean(restConnected)}
        onListTransitions={onListTransitions ?? (async () => [])}
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

  const body = sprintView ? (
    <SprintBody
      project={project}
      restConnected={Boolean(restConnected)}
      loading={sprintLoading}
      error={sprintError}
      lanes={sprintLanes}
      tasksByKey={tasksByKey}
      selectedKey={selectedItem?.key}
      onOpenItem={onOpenItem}
      onOpenTask={onOpenTask}
      onCreateTask={onCreateTask}
    />
  ) : (
    <BoardBody
      restConnected={Boolean(restConnected)}
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="jira-board">
      <header className="flex flex-none items-center gap-3 border-b border-border px-[22px] py-4">
        <h1 className="m-0 mr-auto text-[21px] font-bold tracking-[-0.02em]">JIRA Board</h1>
        <JiraConnection restConnected={Boolean(restConnected)} site={site} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={!ready || !project || busy}
          className="gap-2"
        >
          <RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      {ready && (
        <div className="flex flex-none flex-wrap items-center gap-3 border-b border-border bg-card/50 px-[22px] py-3">
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

          <div className={SEG_TRACK} role="group" aria-label="View mode">
            <button
              type="button"
              data-on={!sprintView}
              aria-pressed={!sprintView}
              onClick={() => onChangeViewMode("board")}
              className={cn(SEG_BUTTON, "gap-1.5")}
            >
              <LayoutGrid className="size-3.5" />
              Board
            </button>
            <button
              type="button"
              data-on={sprintView}
              aria-pressed={sprintView}
              onClick={() => onChangeViewMode("sprint")}
              className={cn(SEG_BUTTON, "gap-1.5")}
            >
              <Rows3 className="size-3.5" />
              Sprint
            </button>
          </div>

          {!sprintView && (
          <>
          <div className={SEG_TRACK} role="group" aria-label="Board filters">
            <button
              type="button"
              data-on={filters.myIssues}
              aria-pressed={filters.myIssues}
              disabled={!project}
              onClick={() => onChangeConfig({ myIssues: !filters.myIssues })}
              className={SEG_BUTTON}
            >
              My issues
            </button>
            <button
              type="button"
              data-on={filters.unresolved}
              aria-pressed={filters.unresolved}
              disabled={!project}
              onClick={() => onChangeConfig({ unresolved: !filters.unresolved })}
              className={SEG_BUTTON}
            >
              Hide done
            </button>
            <button
              type="button"
              data-on={filters.currentSprint}
              aria-pressed={filters.currentSprint}
              disabled={!project}
              onClick={() => onChangeConfig({ currentSprint: !filters.currentSprint })}
              className={SEG_BUTTON}
            >
              Current sprint
            </button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!project}
                className="gap-2"
                aria-label="Filter by status"
              >
                <ListFilter className="size-4" />
                Status
                {filters.statuses.length > 0 && (
                  <Badge variant="secondary" className="ml-0.5">
                    {filters.statuses.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
              {statusFilterOptions.length === 0 ? (
                <DropdownMenuItem disabled>No statuses</DropdownMenuItem>
              ) : (
                statusFilterOptions.map((name) => (
                  <DropdownMenuCheckboxItem
                    key={name}
                    checked={filters.statuses.includes(name)}
                    onCheckedChange={(checked) =>
                      onChangeConfig({
                        statuses: checked
                          ? [...filters.statuses, name]
                          : filters.statuses.filter((status) => status !== name),
                      })
                    }
                    onSelect={(event) => event.preventDefault()}
                  >
                    {name}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <Select
            value={filters.epic ?? ALL_EPICS_VALUE}
            onValueChange={(value) =>
              onChangeConfig({ epic: value === ALL_EPICS_VALUE ? null : value })
            }
            disabled={!project}
          >
            <SelectTrigger className="h-9 w-52" aria-label="Filter by epic">
              <SelectValue placeholder="All epics" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL_EPICS_VALUE}>All epics</SelectItem>
              {epicOptions.map((epic) => (
                <SelectItem key={epic.key} value={epic.key}>
                  {epic.summary ? `${epic.key} · ${epic.summary}` : epic.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </>
          )}

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
          <div className="flex min-h-0 flex-col overflow-hidden">{body}</div>
          {dockedPanel}
        </div>
      ) : (
        body
      )}
    </div>
  );
}

function JiraConnection({
  restConnected,
  site,
}: {
  restConnected: boolean;
  site?: string | null;
}) {
  if (restConnected) {
    return (
      <Badge variant="secondary" className="gap-1.5">
        <span className="size-2 shrink-0 rounded-full bg-status-success" aria-hidden="true" />
        {site ?? "Connected"}
      </Badge>
    );
  }
  return <Badge variant="destructive">Not connected</Badge>;
}
