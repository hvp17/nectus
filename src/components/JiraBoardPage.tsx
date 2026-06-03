import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Skeleton } from "./ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import type { JiraColumn } from "../hooks/useJira";
import type { JiraStatus, JiraWorkItem } from "../types";

interface JiraBoardPageProps {
  status: JiraStatus | undefined;
  columns: JiraColumn[];
  loading: boolean;
  boardJql: string;
  onChangeJql: (jql: string) => void;
  onRefresh: () => void;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}

export function JiraBoardPage({
  status,
  columns,
  loading,
  boardJql,
  onChangeJql,
  onRefresh,
  onTransition,
  onOpenItem,
  onCreateTask,
}: JiraBoardPageProps) {
  const [jql, setJql] = useState(boardJql);
  useEffect(() => setJql(boardJql), [boardJql]);

  const ready = Boolean(status?.installed && status?.authenticated);
  const itemsByKey = new Map(columns.flatMap((column) => column.items).map((item) => [item.key, item]));

  return (
    <div className="jira-board" data-testid="jira-board">
      <header className="jira-board-header flex flex-wrap items-center gap-3 border-b p-4">
        <div className="mr-auto">
          <p className="eyebrow">JIRA</p>
          <h1 className="text-xl font-bold tracking-tight">Board</h1>
        </div>
        <JiraConnection status={status} />
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={!ready || loading} className="gap-2">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <div className="jira-board-toolbar flex items-center gap-2 border-b p-4">
        <Input
          value={jql}
          onChange={(event) => setJql(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onChangeJql(jql.trim());
          }}
          placeholder='project = PROJ AND statusCategory != Done ORDER BY rank'
          className="font-mono text-xs"
          spellCheck={false}
        />
        <Button type="button" size="sm" onClick={() => onChangeJql(jql.trim())} disabled={jql.trim() === boardJql.trim()}>
          Save &amp; Load
        </Button>
      </div>

      <BoardBody
        ready={ready}
        status={status}
        boardJql={boardJql}
        loading={loading}
        columns={columns}
        itemsByKey={itemsByKey}
        onTransition={onTransition}
        onOpenItem={onOpenItem}
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
      <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
      {status.site ?? "Connected"}
    </Badge>
  );
}

interface BoardBodyProps {
  ready: boolean;
  status: JiraStatus | undefined;
  boardJql: string;
  loading: boolean;
  columns: JiraColumn[];
  itemsByKey: Map<string, JiraWorkItem>;
  onTransition: (item: JiraWorkItem, statusName: string) => void;
  onOpenItem: (item: JiraWorkItem) => void;
  onCreateTask: (item: JiraWorkItem) => void;
}

function BoardBody({
  ready,
  status,
  boardJql,
  loading,
  columns,
  itemsByKey,
  onTransition,
  onOpenItem,
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
        Run <code>acli jira auth login</code> in a terminal, then refresh.
      </BoardEmpty>
    );
  }
  if (!boardJql.trim()) {
    return (
      <BoardEmpty title="No board query yet">
        Enter a JQL query above (for example{" "}
        <code>project = PROJ ORDER BY rank</code>) and choose Save &amp; Load.
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
        The board query returned no work items. Adjust the JQL above.
      </BoardEmpty>
    );
  }

  void ready;
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
            <span className="text-sm font-semibold">{column.statusName}</span>
            <Badge variant="secondary">{column.items.length}</Badge>
          </div>
          <div className="flex flex-col gap-2 p-2">
            {column.items.map((item) => (
              <JiraCard
                key={item.key}
                item={item}
                onOpen={() => onOpenItem(item)}
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
  onOpen,
  onCreateTask,
}: {
  item: JiraWorkItem;
  onOpen: () => void;
  onCreateTask: () => void;
}) {
  return (
    <article
      className="jira-card group cursor-pointer rounded-md border bg-background p-3 shadow-sm transition hover:border-primary/50"
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
      <p className="mb-2 line-clamp-3 text-sm font-medium">{item.summary}</p>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[10px]">
          {item.key}
        </Badge>
        {item.issueType && <span className="text-[11px] text-muted-foreground">{item.issueType}</span>}
        {item.assignee && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground">{item.assignee}</span>
        )}
      </div>
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
