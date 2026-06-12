import { useEffect, useState } from "react";
import { FileDiff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { ScrollArea } from "./ui/scroll-area";
import { Skeleton } from "./ui/skeleton";
import { cn } from "../lib/utils";
import type { DiffChangeKind, DiffFileEntry, TaskDiffSummary } from "../types";
import type { FileDiffState } from "../hooks/useTaskDiff";

export interface TaskDiffViewProps {
  summary: TaskDiffSummary | null;
  loading: boolean;
  error: string | null;
  files: Record<string, FileDiffState>;
  /** Asks the owner to lazy-load the patch for a file (idempotent). */
  onSelectFile: (file: string) => void;
}

const GLYPH_ADDED_CLASS = "bg-status-success/16 text-status-success";

const CHANGE_META: Record<DiffChangeKind, { glyph: string; label: string; className: string }> = {
  added: { glyph: "A", label: "Added", className: GLYPH_ADDED_CLASS },
  modified: { glyph: "M", label: "Modified", className: "bg-status-warning/18 text-status-warning" },
  deleted: { glyph: "D", label: "Deleted", className: "bg-destructive/16 text-destructive" },
  untracked: { glyph: "U", label: "New file", className: GLYPH_ADDED_CLASS },
};

const EMPTY_FILES: DiffFileEntry[] = [];

type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

/** The diff surface: file list (left) + unified patch pane (right). */
const DIFF_VIEW_CLASS = "flex h-full min-h-0 bg-card";

const PATCH_EMPTY_CLASS = "p-4 text-xs text-muted-foreground";

const LINE_CLASS: Record<DiffLineKind, string> = {
  add: "bg-status-success/12 border-l-status-success/55",
  del: "bg-destructive/12 border-l-destructive/55",
  hunk: "mt-1 bg-status-info/10 text-status-info",
  meta: "text-muted-foreground",
  context: "",
};

function classifyLine(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("rename ") ||
    line.startsWith("similarity ") ||
    line.startsWith("\\ ")
  ) {
    return "meta";
  }
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

export function TaskDiffView({ summary, loading, error, files, onSelectFile }: TaskDiffViewProps) {
  const fileList = summary?.files ?? EMPTY_FILES;
  const [selected, setSelected] = useState<string | null>(null);

  // Keep a valid selection: default to the first file, and re-anchor if the
  // selected path drops out of a refreshed summary.
  useEffect(() => {
    if (fileList.length === 0) {
      setSelected(null);
      return;
    }
    setSelected((current) =>
      current && fileList.some((file) => file.path === current) ? current : fileList[0].path,
    );
  }, [fileList]);

  const selectedMeta = fileList.find((file) => file.path === selected);

  // Lazy-load the selected file's patch unless it is binary or already in flight.
  useEffect(() => {
    if (!selected || selectedMeta?.binary) return;
    const entry = files[selected];
    if (entry?.patch === undefined && !entry?.loading) onSelectFile(selected);
  }, [selected, selectedMeta, files, onSelectFile]);

  if (loading && !summary) {
    return (
      <div className={DIFF_VIEW_CLASS} aria-label="Task diff" aria-busy="true">
        <div className="flex w-full flex-col gap-2 p-3.5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={DIFF_VIEW_CLASS} aria-label="Task diff">
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertTitle>Could not load the diff</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (summary && fileList.length === 0) {
    return (
      <div className="grid h-full min-h-0 place-items-center bg-card" aria-label="Task diff">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileDiff />
            </EmptyMedia>
            <EmptyTitle>No changes yet</EmptyTitle>
            <EmptyDescription>
              {summary.baseLabel
                ? `Nothing has changed against ${summary.baseLabel}.`
                : "The agent has not modified any files yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const selectedEntry = selected ? files[selected] : undefined;

  return (
    <div className={DIFF_VIEW_CLASS} aria-label="Task diff">
      <div className="flex min-h-0 w-64 shrink-0 flex-col border-r">
        <p className="shrink-0 border-b px-3 py-2 text-[11px] text-muted-foreground">
          {summary?.baseLabel ? `Comparing against ${summary.baseLabel}` : "Working tree changes"}
        </p>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px p-1.5">
            {fileList.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-[5px] text-left text-xs text-foreground hover:bg-accent/60",
                    file.path === selected && "bg-primary/12",
                  )}
                  aria-pressed={file.path === selected}
                  onClick={() => setSelected(file.path)}
                >
                  <DiffGlyph change={file.change} />
                  <DiffPathLabel path={file.path} />
                  <DiffCounts file={file} />
                </button>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {selectedMeta?.binary ? (
          <p className={PATCH_EMPTY_CLASS}>Binary file — no preview.</p>
        ) : selectedEntry?.loading || selectedEntry === undefined ? (
          <div className="flex flex-col gap-2 p-3.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : selectedEntry.error ? (
          <Alert variant="destructive" className="m-3 w-auto">
            <AlertTitle>Could not load this file</AlertTitle>
            <AlertDescription>{selectedEntry.error}</AlertDescription>
          </Alert>
        ) : (
          <DiffPatch patch={selectedEntry.patch ?? ""} />
        )}
      </div>
    </div>
  );
}

function DiffGlyph({ change }: { change: DiffChangeKind }) {
  const meta = CHANGE_META[change];
  return (
    <span
      className={cn(
        "grid size-4.5 shrink-0 place-items-center rounded-[4px] font-mono text-[10px] font-bold",
        meta.className,
      )}
      title={meta.label}
      aria-label={meta.label}
    >
      {meta.glyph}
    </span>
  );
}

function DiffPathLabel({ path }: { path: string }) {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  return (
    <span className="flex min-w-0 flex-1" title={path}>
      {dir && <span className="truncate text-muted-foreground">{dir}</span>}
      <span className="shrink-0 font-medium">{name}</span>
    </span>
  );
}

function DiffCounts({ file }: { file: DiffFileEntry }) {
  if (file.binary) {
    return (
      <span className="flex shrink-0 gap-1.5 font-mono text-[11px] font-medium text-muted-foreground">bin</span>
    );
  }
  return (
    <span className="flex shrink-0 gap-1.5 font-mono text-[11px] font-semibold">
      {file.additions > 0 && <span className="text-status-success">+{file.additions}</span>}
      {file.deletions > 0 && <span className="text-destructive">-{file.deletions}</span>}
    </span>
  );
}

function DiffPatch({ patch }: { patch: string }) {
  if (!patch.trim()) {
    return <p className={PATCH_EMPTY_CLASS}>No textual changes to show.</p>;
  }
  const lines = patch.replace(/\n$/, "").split("\n");
  return (
    <ScrollArea className="h-full">
      <pre className="py-1.5 font-mono text-xs leading-[1.55] [tab-size:2]">
        <code className="block">
          {lines.map((line, index) => {
            const kind = classifyLine(line);
            return (
              <span
                key={index}
                data-line-type={kind}
                className={cn(
                  "block whitespace-pre-wrap border-l-2 border-l-transparent px-3 [overflow-wrap:anywhere]",
                  LINE_CLASS[kind],
                )}
              >
                {line || " "}
              </span>
            );
          })}
        </code>
      </pre>
    </ScrollArea>
  );
}
