import { Layers } from "lucide-react";
import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { JiraCard } from "./JiraCard";
import { groupByEpic } from "../lib/jiraSprints";
import type { JiraSprintLane, JiraWorkItem, TaskSummary } from "../types";

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
      <div className="nx-jira-sprints" aria-busy="true" aria-label="Loading sprints">
        {[0, 1].map((i) => (
          <section key={i} className="nx-jira-sprint">
            <div className="nx-jira-sprint-head">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="nx-jira-sprint-body">
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
    <div className="nx-jira-sprints">
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
    <section className="nx-jira-sprint" data-state={sprint?.state ?? "backlog"}>
      <div className="nx-jira-sprint-head">
        <span className="nx-jira-sprint-name">{title}</span>
        {sprint?.state === "active" && <Badge className="nx-jira-sprint-state">Active</Badge>}
        {sprint?.state === "future" && (
          <Badge variant="secondary" className="nx-jira-sprint-state">
            Future
          </Badge>
        )}
        {range && <span className="nx-jira-sprint-range">{range}</span>}
        <span className="nx-jira-sprint-count">
          <Badge variant="secondary">{lane.items.length}</Badge>
        </span>
      </div>
      {sprint?.goal && <div className="nx-jira-sprint-goal">{sprint.goal}</div>}

      <div className="nx-jira-sprint-body">
        {lane.items.length === 0 ? (
          <div className="nx-jira-sprint-emptylane">
            {isBacklog ? "Backlog is empty." : "No issues in this sprint."}
          </div>
        ) : (
          epicGroups.map((group) => (
            <div className="nx-jira-swimlane" key={group.epicKey ?? "__no_epic"}>
              <div className="nx-jira-swimlane-head">
                <Layers className="size-3.5" aria-hidden="true" />
                <span className="nx-jira-swimlane-name">
                  {group.epicKey ? group.epicName ?? group.epicKey : "No epic"}
                </span>
                {group.epicKey && <span className="nx-jira-swimlane-key">{group.epicKey}</span>}
                <span className="nx-jira-swimlane-count">{group.items.length}</span>
              </div>
              <div className="nx-jira-swimlane-cards">
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
  return <div className="nx-jira-empty">{children}</div>;
}
