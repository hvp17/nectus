import { useEffect, useMemo, useState } from "react";
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

const CHANGE_META: Record<DiffChangeKind, { glyph: string; label: string; className: string }> = {
  added: { glyph: "A", label: "Added", className: "diff-glyph--added" },
  modified: { glyph: "M", label: "Modified", className: "diff-glyph--modified" },
  deleted: { glyph: "D", label: "Deleted", className: "diff-glyph--deleted" },
  untracked: { glyph: "U", label: "New file", className: "diff-glyph--added" },
};

type DiffLineKind = "add" | "del" | "hunk" | "meta" | "context";

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
  const fileList = summary?.files ?? [];
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
  }, [summary]); // eslint-disable-line react-hooks/exhaustive-deps -- re-anchor only when the summary changes

  const selectedMeta = useMemo(
    () => fileList.find((file) => file.path === selected),
    [fileList, selected],
  );

  // Lazy-load the selected file's patch unless it is binary or already in flight.
  useEffect(() => {
    if (!selected || selectedMeta?.binary) return;
    const entry = files[selected];
    if (entry?.patch === undefined && !entry?.loading) onSelectFile(selected);
  }, [selected, selectedMeta, files, onSelectFile]);

  if (loading && !summary) {
    return (
      <div className="diff-view" aria-label="Task diff" aria-busy="true">
        <div className="diff-skeleton">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="diff-view" aria-label="Task diff">
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertTitle>Could not load the diff</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (summary && fileList.length === 0) {
    return (
      <div className="diff-view grid place-items-center" aria-label="Task diff">
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
    <div className="diff-view" aria-label="Task diff">
      <div className="diff-filelist">
        <p className="diff-base-caption">
          {summary?.baseLabel ? `Comparing against ${summary.baseLabel}` : "Working tree changes"}
        </p>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="diff-filelist-items">
            {fileList.map((file) => (
              <li key={file.path}>
                <button
                  type="button"
                  className={cn("diff-file-row", file.path === selected && "diff-file-row--active")}
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

      <div className="diff-patch">
        {selectedMeta?.binary ? (
          <p className="diff-patch-empty">Binary file — no preview.</p>
        ) : selectedEntry?.loading || selectedEntry === undefined ? (
          <div className="diff-patch-loading">
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
    <span className={cn("diff-glyph", meta.className)} title={meta.label} aria-label={meta.label}>
      {meta.glyph}
    </span>
  );
}

function DiffPathLabel({ path }: { path: string }) {
  const lastSlash = path.lastIndexOf("/");
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash + 1) : "";
  const name = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  return (
    <span className="diff-file-path" title={path}>
      {dir && <span className="diff-file-dir">{dir}</span>}
      <span className="diff-file-name">{name}</span>
    </span>
  );
}

function DiffCounts({ file }: { file: DiffFileEntry }) {
  if (file.binary) return <span className="diff-counts diff-counts--binary">bin</span>;
  return (
    <span className="diff-counts">
      {file.additions > 0 && <span className="diff-add">+{file.additions}</span>}
      {file.deletions > 0 && <span className="diff-del">-{file.deletions}</span>}
    </span>
  );
}

function DiffPatch({ patch }: { patch: string }) {
  if (!patch.trim()) {
    return <p className="diff-patch-empty">No textual changes to show.</p>;
  }
  const lines = patch.replace(/\n$/, "").split("\n");
  return (
    <ScrollArea className="h-full">
      <pre className="diff-lines">
        <code>
          {lines.map((line, index) => (
            <span key={index} className={`diff-line diff-line--${classifyLine(line)}`}>
              {line || " "}
            </span>
          ))}
        </code>
      </pre>
    </ScrollArea>
  );
}
