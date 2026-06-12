import { Layers } from "lucide-react";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { JiraCard } from "./JiraCard";
import { groupByEpic } from "../lib/jiraSprints";
import type { JiraSprintLane, JiraWorkItem, TaskSummary } from "../types";

/** Sprint-section scaffolding shared by the loaded view and its loading skeleton. */
const SPRINTS = "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] py-4";
const SPRINT =
  "flex-none overflow-hidden rounded-lg border border-border bg-muted/30 data-[state=active]:border-primary/40";
const SPRINT_HEAD = "flex items-center gap-2.5 border-b border-border bg-card/55 px-3.5 py-[11px]";
const SPRINT_BODY = "flex flex-col gap-3.5 p-3.5";

interface SprintBodyProps {
  project: string | null;
  restConnected: boolean;
  loading: boolean;
  error: string | null;
  lanes: JiraSprintLane[];
  tasksByKey: Map<string, TaskSummary[]>;
  selectedKey?: string;
  onOpenItem: (item: JiraWorkItem) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}

/**
 * Sprint view body: each active/future sprint (then the backlog) as a section,
 * split into epic swimlanes. Read-only — cards open the work-item panel and the
 * create-task action, but there are no status columns and no drag. Without a
 * connected token, prompts the user to connect one.
 */
export function SprintBody({
  project,
  restConnected,
  loading,
  error,
  lanes,
  tasksByKey,
  selectedKey,
  onOpenItem,
  onOpenTask,
  onCreateTask,
}: SprintBodyProps) {
  if (!restConnected) {
    return (
      <SprintEmpty>
        Not connected to JIRA. Paste an API token in <strong>Settings → JIRA</strong> to load
        sprints and the backlog — create one at id.atlassian.com, no other tools needed.
      </SprintEmpty>
    );
  }
  if (!project) {
    return <SprintEmpty>Choose a project above to load its sprints.</SprintEmpty>;
  }
  if (error) {
    return <SprintEmpty>{error}</SprintEmpty>;
  }
  if (loading && lanes.length === 0) {
    return (
      <div className={SPRINTS} aria-busy="true" aria-label="Loading sprints">
        {[0, 1].map((i) => (
          <section key={i} className={SPRINT}>
            <div className={SPRINT_HEAD}>
              <Skeleton className="h-4 w-40" />
            </div>
            <div className={SPRINT_BODY}>
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </section>
        ))}
      </div>
    );
  }

  const hasAnyIssue = lanes.some((lane) => lane.items.length > 0);
  if (!hasAnyIssue) {
    return (
      <SprintEmpty>
        No active or future sprints with issues, and an empty backlog. Plan a sprint in JIRA, then
        refresh.
      </SprintEmpty>
    );
  }

  return (
    <div className={SPRINTS}>
      {lanes.map((lane) => (
        <SprintLane
          key={lane.sprint?.id ?? "backlog"}
          lane={lane}
          tasksByKey={tasksByKey}
          selectedKey={selectedKey}
          onOpenItem={onOpenItem}
          onOpenTask={onOpenTask}
          onCreateTask={onCreateTask}
        />
      ))}
    </div>
  );
}

function SprintLane({
  lane,
  tasksByKey,
  selectedKey,
  onOpenItem,
  onOpenTask,
  onCreateTask,
}: {
  lane: JiraSprintLane;
  tasksByKey: Map<string, TaskSummary[]>;
  selectedKey?: string;
  onOpenItem: (item: JiraWorkItem) => void;
  onOpenTask: (taskId: number) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}) {
  const { sprint } = lane;
  const epicGroups = groupByEpic(lane.items);
  const isBacklog = sprint === null;
  const title = isBacklog ? "Backlog" : sprint.name;
  const range = sprint ? formatSprintRange(sprint.startDate, sprint.endDate) : null;

  return (
    <section className={SPRINT} data-state={sprint?.state ?? "backlog"}>
      <div className={SPRINT_HEAD}>
        <span className="text-sm font-bold tracking-[-0.01em]">{title}</span>
        {sprint?.state === "active" && <Badge className="text-[10px]">Active</Badge>}
        {sprint?.state === "future" && (
          <Badge variant="secondary" className="text-[10px]">
            Future
          </Badge>
        )}
        {range && <span className="font-mono text-[11.5px] text-muted-foreground">{range}</span>}
        <span className="ml-auto">
          <Badge variant="secondary">{lane.items.length}</Badge>
        </span>
      </div>
      {sprint?.goal && (
        <div className="px-3.5 pt-2 text-xs italic text-muted-foreground">{sprint.goal}</div>
      )}

      <div className={SPRINT_BODY}>
        {lane.items.length === 0 ? (
          <div className="px-0.5 py-1.5 text-[12.5px] text-muted-foreground">
            {isBacklog ? "Backlog is empty." : "No issues in this sprint."}
          </div>
        ) : (
          epicGroups.map((group) => (
            <div className="flex flex-col gap-[9px]" key={group.epicKey ?? "__no_epic"}>
              <div className="flex items-center gap-[7px] text-muted-foreground">
                <Layers className="size-3.5" aria-hidden="true" />
                <span className="text-xs font-bold text-foreground">
                  {group.epicKey ? group.epicName ?? group.epicKey : "No epic"}
                </span>
                {group.epicKey && (
                  <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.03em]">
                    {group.epicKey}
                  </span>
                )}
                <span className="ml-auto text-[11px] font-bold">{group.items.length}</span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
                {group.items.map((item) => (
                  <JiraCard
                    key={item.key}
                    item={item}
                    done={item.statusCategory === "done"}
                    selected={item.key === selectedKey}
                    showStatus
                    linkedTasks={tasksByKey.get(item.key) ?? []}
                    onOpen={() => onOpenItem(item)}
                    onOpenTask={onOpenTask}
                    onCreateTask={() => onCreateTask(item)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/** Render a sprint's date range compactly (e.g. "Jun 3 – Jun 17"). */
function formatSprintRange(start?: string | null, end?: string | null): string | null {
  const fmt = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
  const from = start ? fmt(start) : null;
  const to = end ? fmt(end) : null;
  if (from && to) return `${from} – ${to}`;
  return from ?? to ?? null;
}

function SprintEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="m-auto max-w-[460px] p-10 text-center text-[13px] leading-normal text-muted-foreground">
      {children}
    </div>
  );
}
