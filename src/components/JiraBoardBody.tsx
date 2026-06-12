import { Badge } from "./ui/badge";
import { Skeleton } from "./ui/skeleton";
import { JiraCard } from "./JiraCard";
import type { JiraColumn } from "../hooks/useJira";
import type { JiraStatusCategory, JiraWorkItem, TaskSummary } from "../types";

const CATEGORY_DOT: Record<JiraStatusCategory, string> = {
  to_do: "var(--muted-foreground)",
  in_progress: "var(--primary)",
  done: "var(--status-success)",
  unknown: "var(--muted-foreground)",
};

/** Status-column scaffolding shared by the loaded board and its loading skeleton. */
const COLS = "flex min-h-0 flex-1 gap-3.5 overflow-x-auto px-[22px] py-4";
const COL =
  "flex min-h-0 w-[290px] flex-none flex-col overflow-hidden rounded-lg border border-border bg-muted/35";
const COL_HEAD = "flex flex-none items-center gap-2 border-b border-border px-[13px] py-2.5";
const COL_BODY = "flex min-h-0 flex-col gap-[9px] overflow-y-auto p-2.5";

interface BoardBodyProps {
  /** API token connected — the JIRA connection; nothing loads without it. */
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
  if (!restConnected) {
    return (
      <BoardEmpty>
        Not connected to JIRA. Paste an API token in <strong>Settings → JIRA</strong> to load
        the board — create one at id.atlassian.com, no other tools needed.
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
      <div className={COLS} aria-busy="true" aria-label="Loading JIRA board">
        {["To Do", "In Progress", "In Review", "Done"].map((label) => (
          <section key={label} className={COL}>
            <div className={COL_HEAD}>
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3.5 w-24" />
              <span className="ml-auto">
                <Skeleton className="h-5 w-6 rounded-full" />
              </span>
            </div>
            <div className={COL_BODY}>
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
    <div className={COLS}>
      {columns.map((column) => (
        <section
          key={column.statusName}
          className={COL}
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
          <div className={COL_HEAD}>
            <span
              className="size-2 rounded-full"
              style={{ background: CATEGORY_DOT[column.category] }}
              aria-hidden="true"
            />
            <span className="text-[12.5px] font-bold">{column.statusName}</span>
            <span className="ml-auto">
              <Badge variant="secondary">{column.items.length}</Badge>
            </span>
          </div>
          <div className={COL_BODY}>
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
  return (
    <div className="m-auto max-w-[460px] p-10 text-center text-[13px] leading-normal text-muted-foreground">
      {children}
    </div>
  );
}
