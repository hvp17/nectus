import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { JiraCard } from "./JiraCard";
import { isCliConnected } from "../lib/connection";
import type { JiraColumn } from "../hooks/useJira";
import type { JiraStatus, JiraStatusCategory, JiraWorkItem, TaskSummary } from "../types";

const CATEGORY_DOT: Record<JiraStatusCategory, string> = {
  to_do: "var(--muted-foreground)",
  in_progress: "var(--primary)",
  done: "var(--status-success)",
  unknown: "var(--muted-foreground)",
};

interface BoardBodyProps {
  status: JiraStatus | undefined;
  /** API token connected — a full JIRA connection on its own (token-primary). */
  restConnected: boolean;
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

export function BoardBody({
  status,
  restConnected,
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
  if (!restConnected && !isCliConnected(status)) {
    return (
      <BoardEmpty>
        Not connected to JIRA. Paste an API token in <strong>Settings → JIRA</strong>{" "}
        (recommended — no extra tools needed), or install the Atlassian CLI and run{" "}
        <code>acli jira auth login</code> in a terminal.
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
      <div className="nx-jira-cols" aria-busy="true" aria-label="Loading JIRA board">
        {["To Do", "In Progress", "In Review", "Done"].map((label) => (
          <section key={label} className="nx-jira-col">
            <div className="nx-jira-col-head">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
              <span className="nx-cc">
                <Skeleton className="h-5 w-6 rounded-full" />
              </span>
            </div>
            <div className="nx-jira-col-body">
              <Skeleton className="h-28 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </section>
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

function BoardEmpty({ children }: { children: React.ReactNode }) {
  return <div className="nx-jira-empty">{children}</div>;
}
